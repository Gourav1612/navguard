# NaviGuard AI — School Transport Management & Real-Time Tracking

NaviGuard AI is a production-ready, multi-role School Transport Management & Live GPS Tracking SaaS Platform designed to bring visibility, safety, and operational efficiency to student transportation. 

Built using Next.js 15, TypeScript, Tailwind CSS, React Query, and Supabase, it provides interfaces tailored for Administrators, Bus Drivers, Parents, and Students.

---

## 🚀 Tech Stack

- **Framework:** Next.js 15 (App Router, Standalone builds)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **State Management:** React Query (TanStack Query v5)
- **Database:** PostgreSQL (via Supabase) with Row-Level Security (RLS) and Audit Logging
- **Realtime Services:** Supabase Realtime (change-data-capture channels)
- **Maps & Location:** Leaflet.js + OpenStreetMap (browser-bound tile layering)
- **Deployment:** Docker, Docker Compose, Nginx Reverse Proxy
- **Mobile Wrapper:** Capacitor.js (Cross-platform Android / iOS shell)

---

## 📁 Project Directory Structure

```text
├── android/                   # Capacitor Native Android App
│   ├── app/src/main/java/...  # LocationForegroundService.java (silent background tracking service)
│   └── ...
├── app/                       # Next.js 15 App Router (Backend APIs & Pages)
│   ├── actions/               # Server Actions (MFA management, admin pagination/operations)
│   ├── admin/                 # Admin Dashboard Pages (MFA Setup, Fleet commands, Audit logs)
│   ├── api/                   # REST API Endpoints
│   │   ├── admin/             # Admin API routes (buses, drivers, trips, settings configuration)
│   │   ├── driver/            # Driver API routes (telemetry insertion, trip control, passed stops)
│   │   ├── parent/            # Parent API routes (children list, feedback submission)
│   │   ├── student/           # Student API routes (bus tracking)
│   │   └── auth/              # Authentication & user profile API endpoints
│   ├── driver/                # Driver portal screens
│   ├── parent/                # Parent portal screens (live maps)
│   ├── student/               # Student portal screens
│   ├── login/                 # Login & MFA authentication challenges
│   ├── dashboard/             # Unified portal entry point
│   ├── layout.tsx             # Global layout wrapper
│   └── page.tsx               # Redirection router
├── components/                # React Reusable Views & Core Components
│   ├── dashboard/             # Dashboard Layout Views (AdminDashboardView, ParentDashboardView, etc.)
│   │   └── subviews/          # Specific sub-views (SettingsView, AssignmentsView, ImportView)
│   ├── ui/                    # Base UI elements (Modals, skeletons, forms)
│   ├── AdminMap.tsx           # Leaflet telemetry map (with driver phone calling links)
│   └── BottomNav.tsx          # Mobile portal bottom navigation (MFA and role routing)
├── lib/                       # Utility & Shared Helper Functions
│   ├── supabase/              # Browser & Server database initialization clients
│   ├── auth-guard.ts          # Server-side authentication and role check middleware
│   └── utils.ts               # Map coordinate parsers and helper modules
├── public/                    # Static Assets (Version configs, icons, and APK download files)
├── scripts/                   # Native build configurations
├── supabase/                  # Database schema migrations
│   └── consolidated_database_schema.sql # Core SQL schema seed and RLS policies
├── tsconfig.json              # TypeScript compilation rules
├── Dockerfile                 # Standalone multi-stage Next.js builder configuration
└── docker-compose.yml         # Containerized production runtime orchestrator
```

---

## 🛠️ Project Setup

### 1. Supabase Initialization
1. Create a project in your Supabase dashboard.
2. Navigate to the SQL Editor.
3. Open the migration file at `supabase/migrations/20260613000000_init_schema.sql`, copy its contents, and run it in the editor. This initializes:
   - All relational tables and monthly partition structures.
   - Row-Level Security (RLS) policies isolating tenants.
   - User profile auto-creation on auth registration.
   - System audit logging triggers on mutations.
   - Development seed records for immediate testing.
4. **Custom Access Token Hook (Important):** Ensure the `custom_access_token_hook` function is registered as your project's Auth Hook. In Supabase CLI, this is linked automatically. In the cloud dashboard, configure it under **Auth -> Hooks** to allow custom role claims (`role` and `school_id`) to be securely injected into user JWT sessions.

### 2. Environment Variables Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Provide your Supabase URL, Anon Key, Service Role Key (secret, server-side only), and App URL in the fields.

### 3. Local Development Run
Install dependencies:
```bash
npm install
```
Start the Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🐳 Production Deployment (Docker + Nginx)

NaviGuard AI is pre-configured for containerized deployment:

1. **Verify your `.env` configuration:** Ensure the `.env` file in the root directory contains your live production values.
2. **Build and Run Containers:**
   Launch the Next.js web application and Nginx reverse proxy containers. Build-time arguments are automatically configured inside the Dockerfile to embed the client-side Supabase credentials:
   ```bash
   docker-compose up --build -d
   ```
3. **Nginx Details:**
   - Proxies incoming HTTPS queries to Next.js on port 3000.
   - Enforces HSTS and security policies.
   - **Rate Limiting:** Throttles location updates to `/api/driver/location` to `10 req/min per IP` and auth logins to `20 req/min per IP` to mitigate spoofing/DDoS.

---

## 🔑 Demo Access (Seed Accounts)

All seed accounts are initialized with the password `TempPass@123` for testing:

| User Role | Username / Email | Key Features |
|-----------|------------------|--------------|
| **Admin** | `admin@sunriseschool.edu` | Dashboard metrics, Fleet Map, CRUD on buses, routes (stops builder), parent/student profiles, assignments panel, system settings, system audit logs. |
| **Driver**| `driver@school.edu` | Assigned bus/route details, "Start Trip" geolocator trigger, live stops checklist with assigned student rosters, "End Trip" trigger. |
| **Parent**| `priya@gmail.com` | Linked children profiles card, active bus live map tracker with clickable driver phone calling links, dynamic path ETA remaining updates, real-time delay alert reporting to admin. |
| **Student**| `raghav@school.edu` | Personal assigned bus details, live ETA counter, route map visualizer. |
