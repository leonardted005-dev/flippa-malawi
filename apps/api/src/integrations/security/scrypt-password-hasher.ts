import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@fa/domain';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Password hashing adapter using node:crypto scrypt (memory-hard KDF).
 *
 * Stored format: `scrypt$N$r$p$<salt-base64>$<hash-base64>`.
 * Swappable for argon2id later — consumers depend on the PasswordHasher port,
 * never on this class.
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const [scheme, nStr, rStr, pStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !nStr || !rStr || !pStr || !saltB64 || !hashB64) {
      return false;
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scryptAsync(plain, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: MAXMEM,
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}
