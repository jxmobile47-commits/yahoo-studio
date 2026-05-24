import { NextRequest, NextResponse } from 'next/server';
import { getStemdeckApiUrl } from '@/config/serverBackend';
import { createSafeTimeoutSignal } from '@/utils/environmentUtils';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const base = getStemdeckApiUrl();

    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      body: formData,
      signal: createSafeTimeoutSignal(55000),
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
