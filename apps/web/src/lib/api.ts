import type { HealthResponse } from '@fa/contracts';

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${apiBaseUrl}/api/v1/health/live`, { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`API health check failed with status ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
