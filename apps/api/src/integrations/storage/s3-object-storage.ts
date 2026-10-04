import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppEnv } from '@fa/config';
import type {
  ObjectInspection,
  ObjectStorage,
  SignedDownload,
  SignedUpload,
  SignedUploadOptions,
} from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import { PROBE_BYTES, probeImage } from './image-probe';

/**
 * S3-compatible ObjectStorage adapter (dev: MinIO; prod: R2 / B2 / Supabase).
 * Only short-lived signed URLs leave this class — never credentials.
 */
@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.bucket = env.STORAGE_BUCKET;
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }

  async createSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: options.expiresIn });
    return {
      uploadUrl,
      method: 'PUT',
      // Content-Type is signed — the client must send exactly this value.
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async createSignedDownloadUrl(key: string, expiresIn: number): Promise<SignedDownload> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; bytes: number; sha256: string }> {
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, bytes: body.byteLength, sha256 };
  }

  async inspect(key: string): Promise<ObjectInspection | null> {
    const head = await this.client
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => null);
    if (!head) {
      return null;
    }

    const contentType = head.ContentType ?? 'application/octet-stream';
    const sizeBytes = head.ContentLength ?? 0;

    if (!contentType.startsWith('image/')) {
      return { contentType, sizeBytes };
    }

    // Bounded probe: only the header slice, never the whole object.
    const ranged = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${PROBE_BYTES - 1}`,
        }),
      )
      .catch(() => null);

    if (!ranged) {
      return { contentType, sizeBytes };
    }

    const bytes = await ranged.Body?.transformToByteArray();
    const image = bytes ? probeImage(Buffer.from(bytes)) : null;
    return image ? { contentType, sizeBytes, image } : { contentType, sizeBytes };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
