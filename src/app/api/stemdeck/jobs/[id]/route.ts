import { NextRequest, NextResponse } from 'next/server';
import { getStemdeckApiUrl } from '@/config/serverBackend';

export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const base = getStemdeckApiUrl();
    const res = await fetch(`${base}/api/jobs/${id}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const base = getStemdeckApiUrl();
    const res = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
