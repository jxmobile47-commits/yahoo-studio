/**
 * Safe JSON Fetch — handles HTML error pages gracefully
 *
 * Solves "Unexpected token '<', '<!DOCTYPE'..." errors by checking
 * content-type before parsing JSON.
 */

export interface SafeFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function safeJsonFetch<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      // Server returned HTML (likely an error page) — don't try to parse as JSON
      const text = await res.text().catch(() => '');
      const snippet = text.slice(0, 100);
      return {
        ok: false,
        status: res.status,
        data: null,
        error: res.status === 404
          ? `Endpoint not found: ${url}`
          : `Server returned non-JSON response (${res.status}): ${snippet || 'empty'}`,
      };
    }

    let data: T;
    try {
      data = await res.json() as T;
    } catch (err) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `Invalid JSON response: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!res.ok) {
      const errorMsg = (data as { error?: string; message?: string })?.error
        || (data as { error?: string; message?: string })?.message
        || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: errorMsg };
    }

    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
