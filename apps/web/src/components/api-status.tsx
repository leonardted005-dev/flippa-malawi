'use client';

import type { HealthResponse } from '@fa/contracts';
import { useEffect, useState } from 'react';

import { fetchHealth } from '@/lib/api';

type Status =
  { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string };

export function ApiStatus() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((data) => setStatus({ kind: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'unknown error',
        });
      });

    return () => controller.abort();
  }, []);

  if (status.kind === 'loading') {
    return <span className="fa-chip">API: checking…</span>;
  }

  if (status.kind === 'error') {
    return (
      <span className="fa-chip fa-chip--warn" title={status.message}>
        API: unreachable
      </span>
    );
  }

  return (
    <span className="fa-chip fa-chip--ok">
      API: {status.data.status} · {status.data.service}
    </span>
  );
}
