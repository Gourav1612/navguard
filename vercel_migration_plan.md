# Vercel Migration & Cleanup Plan

This document outlines the changes needed to optimize the codebase for **Vercel** hosting, removing redundant VPS configurations and resolving hardcoded URL issues.

---

## Proposed Changes

### 1. Remove Redundant VPS CI/CD Workflow
*   **File:** `.github/workflows/deploy.yml`
*   **Action:** **Delete** or **Disable**
*   **Rationale:** Vercel has built-in CI/CD that deploys the application automatically upon pushing to the `main` branch. The VPS SSH deployment workflow is no longer needed.

### 2. Remove Docker Configuration Files (Optional Cleanup)
*   **Files:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`
*   **Action:** **Delete**
*   **Rationale:** Vercel does not use Docker. Removing these files cleans up the workspace.

### 3. Fix Hardcoded APK URL in Driver Dashboard
*   **File:** `components/dashboard/DriverDashboardView.tsx` (Line 86)
*   **Target Code:**
    ```typescript
    const apkUrl = 'https://navguard-eight.vercel.app/NaviGuard.apk';
    ```
*   **Change to:**
    ```typescript
    const apkUrl = `${window.location.origin}/NaviGuard.apk`;
    ```
*   **Rationale:** Hardcoding the Vercel subdomain prevents the APK download from working if you change your Vercel URL or point a custom domain (like `https://naviguard.in`) to it. Using `window.location.origin` dynamically matches whatever domain the app is running on.

### 4. Sync `capacitor.config.json` Server URL
*   **File:** `capacitor.config.json`
*   **Action:** Ensure the `server.url` matches the active Vercel domain.
    *   If using custom domain: `"url": "https://naviguard.in"`
    *   If testing on Vercel subdomain: `"url": "https://navguard-eight.vercel.app"`
*   **Rationale:** This ensures the Android app connects to the correct Vercel server.

---

## Summary of Benefits
*   **Instant UI updates:** Code pushes will build on Vercel Edge within seconds.
*   **Automated APK hosting:** The `build-apk.yml` workflow will continue to compile the Android app, save it in the `public/` directory, and push it back to GitHub. Vercel will automatically redeploy and serve the updated APK.
*   **Cleaner Workspace:** No more unused Docker containers or SSH credentials active.
