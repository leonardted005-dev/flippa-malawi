import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';

import { Injectable } from '@nestjs/common';

import type { DnsEvidenceReader, HttpEvidenceReader } from '@fa/domain';

/**
 * Live DNS TXT reader. Each call performs a fresh lookup — results are never
 * cached, because a cached answer would defeat the ownership proof.
 */
@Injectable()
export class NodeDnsEvidenceReader implements DnsEvidenceReader {
  async txtRecords(fqdn: string) {
    const values = await dns.resolveTxt(fqdn);
    return [{ name: fqdn, values: values.flat() }];
  }
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Bounded HTTP reader for `/.well-known/*` token checks. Follows at most two
 * redirects, refuses non-HTTP(S) schemes, and never follows a redirect to a
 * private/loopback host (SSRF guard). Bodies are capped at 64 KiB.
 */
@Injectable()
export class BoundedHttpEvidenceReader implements HttpEvidenceReader {
  async fetchText(url: string): Promise<{ status: number; body: string }> {
    let current = new URL(url);
    assertPublicHttpUrl(current);

    for (let hop = 0; hop <= 2; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(current.toString(), {
          signal: controller.signal,
          redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || hop === 2) {
            return { status: response.status, body: '' };
          }
          current = new URL(location, current.toString());
          assertPublicHttpUrl(current);
          continue;
        }
        const text = await response.text();
        return { status: response.status, body: text.slice(0, MAX_BODY_BYTES) };
      } finally {
        clearTimeout(timer);
      }
    }
    return { status: 400, body: '' };
  }
}

/** Rejects non-HTTP URLs and private/loopback/link-local targets. */
export function assertPublicHttpUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-HTTP URL: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '[::1]' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host === '0.0.0.0'
  ) {
    throw new Error('Refusing to fetch private/internal host');
  }
  if (host.startsWith('172.')) {
    const second = Number(host.split('.')[1]);
    if (second >= 16 && second <= 31) {
      throw new Error('Refusing to fetch private/internal host');
    }
  }
  // Link-local + carrier-grade NAT ranges.
  if (host.startsWith('169.254.') || host.startsWith('100.')) {
    const parts = host.split('.').map(Number);
    if (host.startsWith('169.254.')) {
      throw new Error('Refusing to fetch private/internal host');
    }
    if (parts.length === 4 && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) {
      throw new Error('Refusing to fetch private/internal host');
    }
  }
}

/** sha256 hex of the challenge token (stored; the plaintext never persists). */
export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
