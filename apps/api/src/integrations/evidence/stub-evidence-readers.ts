import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Deterministic evidence-reader doubles for tests: canned DNS TXT answers and
 * HTTP bodies keyed by exact target. Production wires the live readers.
 */
@Injectable()
export class StubEvidenceReaders {
  private readonly txt = new Map<string, string[]>();
  private readonly pages = new Map<string, { status: number; body: string }>();

  setTxt(fqdn: string, values: string[]): void {
    this.txt.set(fqdn.toLowerCase(), values);
  }

  setPage(url: string, body: string, status = 200): void {
    this.pages.set(url, { status, body });
  }

  reset(): void {
    this.txt.clear();
    this.pages.clear();
  }

  async txtRecords(fqdn: string) {
    const values = this.txt.get(fqdn.toLowerCase()) ?? [];
    if (values.length === 0) {
      const error = new Error(`queryTxt ENOTFOUND ${fqdn}`) as Error & { code: string };
      error.code = 'ENOTFOUND';
      throw error;
    }
    return [{ name: fqdn, values }];
  }

  async fetchText(url: string) {
    return this.pages.get(url) ?? { status: 404, body: '' };
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
