import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppEnv } from '@fa/config';

import { APP_ENV } from '../../common/config/config.module';

const IV_BYTES = 12;

/**
 * AES-256-GCM field encryption for sensitive values at rest (e.g. payout
 * account references). Ciphertext format: `v1.<iv>.<tag>.<data>` (base64).
 * Plaintext is never persisted or logged.
 */
@Injectable()
export class FieldCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    // Derive a fixed 32-byte key from configured high-entropy secret material.
    this.key = createHash('sha256').update(env.FIELD_ENCRYPTION_KEY, 'utf8').digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
