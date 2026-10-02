import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '@fa/config';
import type { ObjectStorage } from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { OBJECT_STORAGE } from '../../common/tokens';
import type { PresignUploadDto } from './uploads.dto';
import { StorageObjectRepository } from './uploads.repository';
import { SellerRepository } from '../sellers/sellers.repository';
import { SellersService } from '../sellers/sellers.service';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class UploadsService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly objects: StorageObjectRepository,
    private readonly sellers: SellerRepository,
    private readonly sellersService: SellersService,
    private readonly audit: AuditService,
  ) {}

  /** Presigned PUT + a StorageObject row (private, pending inspection). */
  async presign(
    userId: string,
    dto: PresignUploadDto,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new ConflictException({
        code: 'SELLER_PROFILE_REQUIRED',
        message: 'Create a seller profile before uploading media',
      });
    }
    // Tier quota is enforced server-side against the DECLARED size (verified
    // again against the real size on completion).
    await this.sellersService.assertUploadWithinQuota(userId, dto.sizeBytes);

    const extension = EXTENSION_BY_TYPE[dto.contentType] ?? 'bin';
    const key = `sellers/${seller.id}/uploads/${randomUUID()}.${extension}`;

    const signed = await this.storage.createSignedUploadUrl(key, {
      method: 'PUT',
      contentType: dto.contentType,
      expiresIn: this.env.STORAGE_SIGNED_URL_TTL,
    });

    const object = await this.objects.create({
      bucket: this.env.STORAGE_BUCKET,
      key,
      ownerType: 'SELLER',
      ownerId: seller.id,
      contentType: dto.contentType,
      sizeBytes: BigInt(dto.sizeBytes),
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'UPLOAD_PRESIGNED',
      entityType: 'StorageObject',
      entityId: object.id,
      after: { contentType: dto.contentType, sizeBytes: dto.sizeBytes },
      ...meta,
    });

    return {
      id: object.id,
      key,
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** Validates the object the client ACTUALLY uploaded (never trusts the client). */
  async complete(
    userId: string,
    objectId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const seller = await this.sellers.findByUserId(userId);
    const object = await this.objects.findById(objectId);
    if (!seller || !object || object.ownerId !== seller.id) {
      throw new NotFoundException({ code: 'UPLOAD_NOT_FOUND', message: 'Upload not found' });
    }

    const inspection = await this.storage.inspect(object.key);
    if (!inspection) {
      throw new BadRequestException({
        code: 'UPLOAD_OBJECT_MISSING',
        message: 'Upload not found in object storage; call presign again',
      });
    }

    // Re-verify the REAL size against the seller's tier (declared size is untrusted).
    await this.sellersService.assertUploadWithinQuota(userId, inspection.sizeBytes);

    if (inspection.contentType !== object.contentType) {
      throw new BadRequestException({
        code: 'CONTENT_TYPE_MISMATCH',
        message: `Uploaded content type "${inspection.contentType}" does not match "${object.contentType}"`,
      });
    }

    const isImage = object.contentType.startsWith('image/');
    if (isImage && !inspection.image) {
      // Magic bytes are not a supported image -> malicious or mislabeled upload.
      throw new BadRequestException({
        code: 'IMAGE_PROBE_FAILED',
        message: 'Uploaded bytes are not a valid JPEG, PNG, WebP or GIF image',
      });
    }

    const updated = await this.objects.updateInspection(object.id, {
      sizeBytes: BigInt(inspection.sizeBytes),
      visibility: 'REVIEW',
      ...(inspection.image
        ? {
            width: inspection.image.width,
            height: inspection.image.height,
            imageFormat: inspection.image.format,
          }
        : {}),
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'UPLOAD_COMPLETED',
      entityType: 'StorageObject',
      entityId: object.id,
      after: {
        sizeBytes: inspection.sizeBytes,
        imageFormat: inspection.image?.format ?? null,
        width: inspection.image?.width ?? null,
        height: inspection.image?.height ?? null,
      },
      ...meta,
    });

    return toUploadView(updated);
  }

  async signedUrl(userId: string, objectId: string): Promise<Record<string, unknown>> {
    const seller = await this.sellers.findByUserId(userId);
    const object = await this.objects.findById(objectId);
    if (!seller || !object || object.ownerId !== seller.id) {
      throw new NotFoundException({ code: 'UPLOAD_NOT_FOUND', message: 'Upload not found' });
    }

    const signed = await this.storage.createSignedDownloadUrl(
      object.key,
      this.env.STORAGE_SIGNED_URL_TTL,
    );
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}

function toUploadView(object: {
  id: string;
  key: string;
  contentType: string;
  sizeBytes: bigint;
  visibility: string;
  scanStatus: string;
  width: number | null;
  height: number | null;
  imageFormat: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: object.id,
    key: object.key,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes.toString(),
    visibility: object.visibility,
    scanStatus: object.scanStatus,
    width: object.width,
    height: object.height,
    imageFormat: object.imageFormat,
    createdAt: object.createdAt.toISOString(),
  };
}
