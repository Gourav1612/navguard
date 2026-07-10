import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
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

  // Bypass public assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.') // matches favicon.ico, manifest.json, css, image files, etc.
  ) {
    return response;
  }

  // Redirect to login if unauthenticated
  if (!user) {
    if (pathname !== '/login') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  let role = user.user_metadata?.role;
  let is_active = user.user_metadata?.is_active ?? true;

  // Fallback to database query only if metadata role is missing (optimizes network calls)
  if (!role) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    if (profile) {
      role = profile.role;
      is_active = profile.is_active;
    }
  }


  // If user profile is not found or is deactivated, force log out
  if (!role || !is_active) {
    if (pathname === '/login') {
      return response;
    }
    const loginRedirect = NextResponse.redirect(new URL('/login', request.url));
    // Clear cookies
    loginRedirect.cookies.delete('sb-access-token');
    loginRedirect.cookies.delete('sb-refresh-token');
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
      }
      // 2. Force challenge if factor is set up but session is not elevated (currentLevel is aal1 and nextLevel is aal2)
      else if (nextLevel === 'aal2' && currentLevel === 'aal1') {
        if (pathname !== '/login/mfa-challenge') {
          return NextResponse.redirect(new URL('/login/mfa-challenge', request.url));
        }
      }
    }
  }

  // Redirect if visiting /login or root / when authenticated
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
    driver: '/driver',
    parent: '/parent',
    student: '/student',
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
