-- ============================================================
-- NaviGuard Workforce Safety — Obsolete Schema Cleanup Migration
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
