import crypto from 'crypto';
import { NextResponse } from 'next/server';

/**
 * Generates a cryptographically secure 6-digit numeric OTP using CSPRNG.
 */
export function generateSecureOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Performs a timing-safe string comparison to mitigate timing side-channel attacks.
 */
export function timingSafeMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolves the trusted application origin strictly from environment configuration,
 * rejecting unvalidated or spoofable Host / X-Forwarded-Host headers in production.
 */
export function getTrustedAppOrigin(req?: Request): string {
  const configuredOrigin =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;

  if (configuredOrigin && configuredOrigin.startsWith('http')) {
    return configuredOrigin.replace(/\/$/, '');
  }

  // Fallback in development if environment variables are not explicitly set
  if (process.env.NODE_ENV === 'development' && req) {
    const host = req.headers.get('host');
    if (host) {
      const proto = req.headers.get('x-forwarded-proto') || 'http';
      return `${proto}://${host}`;
    }
  }

  return 'https://navguard-eight.vercel.app';
}

/**
 * Returns a sanitized JSON error response to clients, masking internal database schemas
 * and stack traces while logging the full diagnostic details server-side.
 */
export function safeErrorResponse(
  err: unknown,
  defaultMessage = 'An unexpected server error occurred. Please try again later.',
  status = 500
): NextResponse {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error(`[API Error (${status})]:`, errorMessage, err);

  return NextResponse.json(
    {
      error: defaultMessage,
      code: 'SERVER_ERROR',
    },
    { status }
  );
}
