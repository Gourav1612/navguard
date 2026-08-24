-- ============================================================
-- NaviGuard Workforce Safety — Hierarchical Multi-Plant Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE SCHEMA IF NOT EXISTS audit;

-- ============================================================
-- DROP OBSOLETE SCHOOL TABLES & TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;

DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.bus_locations CASCADE;
DROP TABLE IF EXISTS public.trips CASCADE;
DROP TABLE IF EXISTS public.parent_student_links CASCADE;
DROP TABLE IF EXISTS public.parent_profiles CASCADE;
DROP TABLE IF EXISTS public.student_profiles CASCADE;
DROP TABLE IF EXISTS public.stops CASCADE;
DROP TABLE IF EXISTS public.routes CASCADE;
DROP TABLE IF EXISTS public.drivers CASCADE;
DROP TABLE IF EXISTS public.buses CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;
DROP TABLE IF EXISTS public.schools CASCADE;

-- ============================================================
-- CREATE WORKFORCE TABLES
-- ============================================================

-- 1. Plants (Industrial Multi-Plant Sites)
CREATE TABLE public.plants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL,
    code                TEXT UNIQUE NOT NULL, -- e.g., "IW-01"
    address             TEXT,
    latitude            DECIMAL(10, 7),
    longitude           DECIMAL(10, 7),
    radius_meters       DOUBLE PRECISION DEFAULT 100, -- Geofence radius
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plants_code ON public.plants(code);

-- 2. User Profiles (Extends auth.users, with self-referencing hierarchy)
CREATE TABLE public.user_profiles (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    plant_id            UUID REFERENCES public.plants(id) ON DELETE SET NULL,
    supervisor_id       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    role                TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'supervisor', 'worker')),
    full_name           TEXT NOT NULL,
    email               TEXT NOT NULL UNIQUE,
    phone               TEXT,
    avatar_url          TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    location_interval   INTEGER DEFAULT 10,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_plant_id ON public.user_profiles(plant_id);
CREATE INDEX idx_user_profiles_supervisor_id ON public.user_profiles(supervisor_id);
CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);

-- 3. Live Locations (Universal Real-Time Telemetry Pool)
CREATE TABLE public.live_locations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    latitude            DECIMAL(10, 7) NOT NULL,
    longitude           DECIMAL(10, 7) NOT NULL,
    speed               DECIMAL(6, 2) DEFAULT 0, -- Speed in km/h
    heading             DECIMAL(6, 2) DEFAULT 0, -- Heading in degrees
    accuracy            DECIMAL(6, 2) DEFAULT 0, -- GPS accuracy in meters
    battery_level       INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
    is_tracking         BOOLEAN DEFAULT TRUE,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_live_locations_recorded_at ON public.live_locations(recorded_at DESC);

-- 4. Audit Logs
CREATE TABLE public.audit_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id            UUID REFERENCES public.plants(id) ON DELETE SET NULL,
    user_id             UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action              TEXT NOT NULL,
    table_name          TEXT,
    record_id           UUID,
    old_values          JSONB,
    new_values          JSONB,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_plant_id ON public.audit_logs(plant_id);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ============================================================
-- TRIGGERS & PROCEDURES
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_plants BEFORE UPDATE ON public.plants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at_user_profiles BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auto-profile creator on Auth User creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role, plant_id, supervisor_id, location_interval)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        CASE 
            WHEN COALESCE(NEW.raw_user_meta_data->>'role', '') IN ('admin', 'manager', 'supervisor', 'worker') THEN NEW.raw_user_meta_data->>'role'
            ELSE 'worker'
        END,
        (NEW.raw_user_meta_data->>'plant_id')::uuid,
        (NEW.raw_user_meta_data->>'supervisor_id')::uuid,
        COALESCE((NEW.raw_user_meta_data->>'location_interval')::integer, 10)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Audit log recorder
CREATE OR REPLACE FUNCTION audit.log_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.audit_logs (
        plant_id, user_id, action, table_name, record_id,
        old_values, new_values
    )
    VALUES (
        COALESCE(
            (SELECT plant_id FROM public.user_profiles WHERE id = auth.uid()),
            (SELECT plant_id FROM public.user_profiles WHERE id = COALESCE(NEW.id, OLD.id))
        ),
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_plants AFTER INSERT OR UPDATE OR DELETE ON public.plants FOR EACH ROW EXECUTE FUNCTION audit.log_changes();
CREATE TRIGGER audit_user_profiles AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION audit.log_changes();

-- ============================================================
-- HELPER FUNCTIONS FOR SECURITY / POLICIES
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(auth.jwt()->>'user_role', '');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT public.user_role() = 'admin';
$$;

-- Custom Access Token Hook
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claims jsonb;
  user_role text;
  user_plant_id uuid;
BEGIN
  -- Retrieve the user's role and plant ID
  SELECT role, plant_id INTO user_role, user_plant_id
  FROM public.user_profiles
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';
  
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  END IF;
  
  IF user_plant_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{plant_id}', to_jsonb(user_plant_id));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- 1. PLANTS
CREATE POLICY plants_admin_all ON public.plants FOR ALL USING (public.is_admin());
CREATE POLICY plants_select ON public.plants FOR SELECT USING (
    id = (SELECT plant_id FROM public.user_profiles WHERE id = auth.uid())
);

-- 2. USER_PROFILES
CREATE POLICY user_profiles_admin_all ON public.user_profiles FOR ALL USING (public.is_admin());
CREATE POLICY user_profiles_plant_select ON public.user_profiles FOR SELECT USING (
    plant_id = (SELECT plant_id FROM public.user_profiles WHERE id = auth.uid())
);
CREATE POLICY user_profiles_self ON public.user_profiles FOR SELECT USING (id = auth.uid());

-- 3. LIVE_LOCATIONS
CREATE POLICY live_locations_admin_all ON public.live_locations FOR ALL USING (public.is_admin());
CREATE POLICY live_locations_manager_select ON public.live_locations FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles mgr
        JOIN public.user_profiles usr ON usr.plant_id = mgr.plant_id
        WHERE mgr.id = auth.uid() AND mgr.role = 'manager' AND usr.id = live_locations.user_id
    )
);
CREATE POLICY live_locations_supervisor_select ON public.live_locations FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles usr
        WHERE usr.supervisor_id = auth.uid() AND usr.id = live_locations.user_id
    )
);
CREATE POLICY live_locations_worker_select ON public.live_locations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY live_locations_self_upsert ON public.live_locations FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. AUDIT_LOGS
CREATE POLICY audit_logs_admin_select ON public.audit_logs FOR SELECT USING (public.is_admin());
CREATE POLICY audit_logs_system_insert ON public.audit_logs FOR INSERT WITH CHECK (true);

-- ============================================================
-- AUTOMATIC LOG CLEANUP (pg_cron)
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    DELETE FROM public.audit_logs WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cleanup-audit-logs-job';

SELECT cron.schedule(
    'cleanup-audit-logs-job',
    '0 * * * *', -- runs at minute 0 of every hour
    $$ SELECT public.cleanup_old_audit_logs(); $$
);

-- Sync existing auth users to profiles so they can log in immediately
INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
SELECT 
    id, 
    email, 
    COALESCE(raw_user_meta_data->>'full_name', email), 
    CASE 
        WHEN COALESCE(raw_user_meta_data->>'role', '') IN ('admin', 'manager', 'supervisor', 'worker') THEN raw_user_meta_data->>'role'
        ELSE 'worker'
    END,
    TRUE
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Enforce Gaurav's account to admin role explicitly
UPDATE public.user_profiles 
SET role = 'admin' 
WHERE email = 'gauravbalchandani@gmail.com';

