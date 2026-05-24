import { NextResponse } from 'next/server';
import { getPythonApiUrl } from '@/config/serverBackend';
import { createSafeTimeoutSignal } from '@/utils/environmentUtils';

/**
 * HTDemucs Status Check
 * Proxies to Python backend /api/stem/status
 */
export async function GET() {
  try {
    const backendUrl = getPythonApiUrl();
    const response = await fetch(`${backendUrl}/api/stem/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: createSafeTimeoutSignal(25000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, available: false, error: `Backend error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, available: false, error: msg },
      { status: 500 }
    );
  }
}
