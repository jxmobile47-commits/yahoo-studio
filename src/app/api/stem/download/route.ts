import { NextRequest, NextResponse } from 'next/server';
import { getPythonApiUrl } from '@/config/serverBackend';
import { createSafeTimeoutSignal } from '@/utils/environmentUtils';

export const maxDuration = 120;

/**
 * HTDemucs Stem Download
 * Proxies to Python backend /api/stem/download
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    const name = searchParams.get('name') || 'stem';

    if (!path) {
      return NextResponse.json({ success: false, error: 'Missing path parameter' }, { status: 400 });
    }

    const backendUrl = getPythonApiUrl();
    const res = await fetch(`${backendUrl}/api/stem/download?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`, {
      signal: createSafeTimeoutSignal(110000),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Download failed: ${res.status}` }, { status: res.status });
    }

    const blob = await res.blob();
    return new Response(blob, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${name}.wav"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
