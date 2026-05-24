import { NextRequest, NextResponse } from 'next/server';
import { getPythonApiUrl } from '@/config/serverBackend';
import { createSafeTimeoutSignal } from '@/utils/environmentUtils';

export const maxDuration = 300;

/**
 * HTDemucs Stem Separation
 * Proxies audio file to Python backend /api/stem/separate
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const backendUrl = getPythonApiUrl();

    const res = await fetch(`${backendUrl}/api/stem/separate`, {
      method: 'POST',
      body: formData,
      signal: createSafeTimeoutSignal(290000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return NextResponse.json({ success: false, error: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
