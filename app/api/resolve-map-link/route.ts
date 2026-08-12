import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';

const ALLOWED_MAP_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
]);

function isAllowedMapsUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  return ALLOWED_MAP_HOSTS.has(hostname) || hostname.endsWith('.google.com');
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin', 'driver', 'parent', 'student']);
  if (auth.error) return auth.error;

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'URL query parameter is required' }, { status: 400 });
  }

  if (!isAllowedMapsUrl(url)) {
    return NextResponse.json(
      { error: 'Only HTTPS Google Maps links are supported' },
      { status: 400 }
    );
  }

  try {
    let currentUrl = url;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(currentUrl, { method: 'HEAD', redirect: 'manual' });
      const location = res.headers.get('location');
      if (!location) {
        return NextResponse.json({ expandedUrl: res.url || currentUrl });
      }

      const nextUrl = new URL(location, currentUrl).toString();
      if (!isAllowedMapsUrl(nextUrl)) {
        return NextResponse.json(
          { error: 'Resolved link leaves the allowed Google Maps domains' },
          { status: 400 }
        );
      }
      currentUrl = nextUrl;
    }

    return NextResponse.json({ error: 'Too many redirects' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to expand link' }, { status: 500 });
  }
}
