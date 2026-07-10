import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'URL query parameter is required' }, { status: 400 });
  }

  try {
    // Standard server-side fetch automatically follows redirects by default
    const res = await fetch(url, { redirect: 'follow' });
    return NextResponse.json({ expandedUrl: res.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to expand link' }, { status: 500 });
  }
}
