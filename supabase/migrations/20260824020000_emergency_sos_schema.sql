-- ============================================================
-- NaviGuard Emergency SOS Schema & Realtime Routing
-- ============================================================

CREATE TABLE IF NOT EXISTS public.emergency_alerts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id           UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    supervisor_id       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    plant_id            UUID REFERENCES public.plants(id) ON DELETE SET NULL,
    sender_role         TEXT NOT NULL CHECK (sender_role IN ('admin', 'manager', 'supervisor', 'worker')),
    sender_name         TEXT NOT NULL,
    plant_name          TEXT,
    latitude            DECIMAL(10, 7),
    longitude           DECIMAL(10, 7),
    accuracy            DECIMAL(6, 2) DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    message             TEXT DEFAULT 'Emergency SOS Triggered',
    resolved_by         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status ON public.emergency_alerts(status);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_plant_id ON public.emergency_alerts(plant_id);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_supervisor_id ON public.emergency_alerts(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_sender_id ON public.emergency_alerts(sender_id);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_created_at ON public.emergency_alerts(created_at DESC);

-- Enable RLS
ALTER TABLE public.emergency_alerts ENABLE ROW LEVEL SECURITY;

-- 1. Insert Policy: Authenticated users can insert their own SOS
CREATE POLICY emergency_alerts_insert ON public.emergency_alerts
FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- 2. Select Policy: Hierarchical Visibility
CREATE POLICY emergency_alerts_select ON public.emergency_alerts
FOR SELECT USING (
    -- Admins can see all alerts
    public.is_admin()
    OR
    -- Sender can always see their own alerts
    sender_id = auth.uid()
    OR
    -- Managers see all alerts from their plant
    (
        EXISTS (
            SELECT 1 FROM public.user_profiles mgr
            WHERE mgr.id = auth.uid()
              AND mgr.role = 'manager'
              AND mgr.plant_id = emergency_alerts.plant_id
        )
    )
    OR
    -- Supervisors:
    -- (a) Worker SOS: Only assigned supervisor
    -- (b) Manager SOS: All supervisors of that plant
    (
        EXISTS (
            SELECT 1 FROM public.user_profiles sup
            WHERE sup.id = auth.uid()
              AND sup.role = 'supervisor'
              AND (
                  (emergency_alerts.sender_role = 'worker' AND emergency_alerts.supervisor_id = sup.id)
                  OR
                  (emergency_alerts.sender_role = 'manager' AND emergency_alerts.plant_id = sup.plant_id)
              )
        )
    )
);

-- 3. Update Policy: Admins, Plant Managers, and Assigned Supervisors can resolve alerts
CREATE POLICY emergency_alerts_update ON public.emergency_alerts
FOR UPDATE USING (
    public.is_admin()
    OR
    (
        EXISTS (
            SELECT 1 FROM public.user_profiles mgr
            WHERE mgr.id = auth.uid()
              AND mgr.role = 'manager'
              AND mgr.plant_id = emergency_alerts.plant_id
        )
    )
    OR
    (
        EXISTS (
            SELECT 1 FROM public.user_profiles sup
            WHERE sup.id = auth.uid()
              AND sup.role = 'supervisor'
              AND (
                  (emergency_alerts.sender_role = 'worker' AND emergency_alerts.supervisor_id = sup.id)
                  OR
                  (emergency_alerts.sender_role = 'manager' AND emergency_alerts.plant_id = sup.plant_id)
              )
        )
    )
);

-- Enable Realtime publication for emergency_alerts table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'emergency_alerts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_alerts;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;
