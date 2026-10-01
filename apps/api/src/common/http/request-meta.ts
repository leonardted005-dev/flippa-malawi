import { createHash } from 'node:crypto';

import type { Request } from 'express';

export interface RequestMeta {
  ipHash?: string | null;
  userAgent?: string | null;
}

/**
 * Derives audit-safe request metadata. The raw IP is NEVER stored — only a
 * SHA-256 digest — and the user agent is truncated.
 */
function buildRequestMeta(request: Request): RequestMeta {
  const ip = request.ip ?? request.socket.remoteAddress ?? null;
  const userAgent = request.headers['user-agent'];
  return {
    ipHash: ip ? createHash('sha256').update(ip, 'utf8').digest('hex') : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

/** Canonical helper used by new feature code. */
export const requestMetaFromRequest = buildRequestMeta;

/** Historical alias retained for existing call sites. */
export const deriveRequestMeta = buildRequestMeta;
