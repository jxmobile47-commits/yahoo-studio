import { NextRequest, NextResponse } from 'next/server';
import { getStemdeckApiUrl } from '@/config/serverBackend';
import { createSafeTimeoutSignal } from '@/utils/environmentUtils';

export const maxDuration = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  try {
    const { id, name } = await params;
    const base = getStemdeckApiUrl();
    const res = await fetch(`${base}/api/jobs/${id}/stems/${name}.wav`, {
      signal: createSafeTimeoutSignal(110000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Stem not found: ${res.status}` }, { status: res.status });
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${name}.wav"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
