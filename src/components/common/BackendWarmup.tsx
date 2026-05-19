'use client';

import { useEffect } from 'react';

/**
 * Wakes up the backend (HF Space cold start) by pinging /api/health.
 * Mounts once on app load so backend is ready by the time user pastes a URL.
 *
 * HF Spaces sleep after 48 hours of inactivity → first request takes 30-60s
 * to wake them. This component fires-and-forgets a ping so the wake-up
 * happens in parallel with the user reading/navigating the page.
 */
export default function BackendWarmup() {
  useEffect(() => {
    // Don't block — fire and forget
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    fetch('/api/health', {
      method: 'GET',
      signal: controller.signal,
    })
      .catch(() => { /* expected if backend asleep — wake-up will happen */ })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return null;
}
