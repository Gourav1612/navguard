import { createServerClient } from '@supabase/ssr';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  // Log request method and path to stdout for visibility in production docker logs
  console.log(`[${request.method}] ${request.nextUrl.pathname}${request.nextUrl.search || ''}`);

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            });
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Bypass public assets and api routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.') // matches favicon.ico, logo.png, manifest.json, css/js files, etc.
  ) {
    return response;
  }

  // Redirect to login if unauthenticated
  if (!user) {
    if (pathname === '/reset-password') {
      const hasToken = request.nextUrl.searchParams.has('token') && (request.nextUrl.searchParams.get('token')?.trim() || '').length > 0;
      const hasEmail = request.nextUrl.searchParams.has('email') && (request.nextUrl.searchParams.get('email')?.trim() || '').length > 0;
      if (hasToken && hasEmail) {
        return response;
      }
    }

    if (pathname !== '/login') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  let role = user.user_metadata?.role;
  let is_active = user.user_metadata?.is_active ?? true;

  // Fallback to admin service client if metadata role is missing to bypass RLS restrictions in middleware
  if (!role && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { data: profile } = await adminClient
        .from('user_profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        role = profile.role;
        is_active = profile.is_active;
      }
    } catch (err) {
      console.error('[Proxy] Failed to fetch profile via admin client:', err);
    }
  }

  // If user profile is not found or is deactivated, force log out & delete all Supabase auth cookies
  if (!role || !is_active) {
    if (pathname === '/login') {
      return response;
    }
    const loginRedirect = NextResponse.redirect(new URL('/login', request.url));
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith('sb-')) {
        loginRedirect.cookies.delete(cookie.name);
      }
    });
    return loginRedirect;
  }

  // MFA checks for admin accounts
  if (role === 'admin') {
    const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (mfaData) {
      const { currentLevel, nextLevel } = mfaData;

      // 1. Force enrollment if no factor is set up (nextLevel is aal1)
      if (nextLevel === 'aal1') {
        if (pathname !== '/admin/mfa-setup') {
          return NextResponse.redirect(new URL('/admin/mfa-setup', request.url));
        }
        return response;
      }
      // 2. Force challenge if factor is set up but session is not elevated
      else if (nextLevel === 'aal2' && currentLevel === 'aal1') {
        if (pathname !== '/login/mfa-challenge') {
          return NextResponse.redirect(new URL('/login/mfa-challenge', request.url));
        }
        return response;
      }
    }
  }

  // Redirect if visiting /login or root / when fully authenticated & MFA verified
  if (pathname === '/login' || pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect role-specific dashboard paths to the unified dashboard
  if (pathname.endsWith('/dashboard') && pathname !== '/dashboard') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Enforce role boundaries
  const rolePrefixes: Record<string, string> = {
    admin: '/admin',
    manager: '/manager',
    supervisor: '/supervisor',
    worker: '/worker',
  };

  // Check if user is trying to access a path starting with another role's prefix
  for (const [key, prefix] of Object.entries(rolePrefixes)) {
    if (pathname.startsWith(prefix) && role !== key) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
