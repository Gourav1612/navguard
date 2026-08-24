import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';
import { PlantSchema } from '@/lib/validations';

export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  try {
    const { data: plants, error } = await supabase
      .from('plants')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(plants);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const parsed = PlantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: plant, error } = await supabase
      .from('plants')
      .insert(parsed.data)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(plant);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
