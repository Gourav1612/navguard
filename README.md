# NaviGuard AI — School Transport Management & Real-Time Tracking

NaviGuard AI is a production-ready, multi-role School Transport Management & Live GPS Tracking SaaS Platform designed to bring visibility, safety, and operational efficiency to student transportation. 

Built using Next.js 15, TypeScript, Tailwind CSS, React Query, and Supabase, it provides tailor-made interfaces for Administrators, Bus Drivers, Parents, and Students.

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
Copy `.env.example` to `.env.local` (for local development) or `.env` (for Docker production):
```bash
cp .env.example .env.local
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
   Launch the Next.js web application and Nginx reverse proxy containers:
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
| **Admin** | `admin@sunriseschool.edu` | Dashboard metrics, Fleet Map, CRUD on buses, routes (stops builder), parent/student profiles, assignments panel, system audit logs. |
| **Driver** | `driver@school.edu` | Assigned bus/route details, "Start Trip" geolocator trigger, live stops checklist with assigned student rosters, "End Trip" trigger. |
| **Parent** | `priya@gmail.com` | Linked children profiles selector card, active bus live map tracker, dynamic path ETA remaining updates, announcements. |
| **Student**| `raghav@school.edu` | Personal assigned bus details, live ETA counter, route map visualizer, announcements panel. |
