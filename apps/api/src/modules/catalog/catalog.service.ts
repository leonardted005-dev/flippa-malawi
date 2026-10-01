import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { listAssetTypeDescriptors, validateAssetMetadata, type AssetType } from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { SellerRepository } from '../sellers/sellers.repository';
import type { CreateAssetDto, UpdateAssetDto } from './catalog.dto';
import { serializeValue, toNestedMetadata } from './catalog.mapper';
import { AssetRepository, CategoryRepository, type AssetWithMetadata } from './catalog.repository';

const METADATA_KEYS = [
  'software',
  'website',
  'mobile',
  'youtube',
  'instagram',
  'game',
  'domain',
] as const;

/** Client-safe description of every asset kind (drives web/mobile forms). */
export interface AssetTypeView {
  type: AssetType;
  label: string;
  ownershipVerification: string;
  requiresManualReview: boolean;
  metrics: readonly string[];
  naturalKey: string;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly assets: AssetRepository,
    private readonly categories: CategoryRepository,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
  ) {}

  listAssetTypes(): AssetTypeView[] {
    return listAssetTypeDescriptors().map((descriptor) => ({
      type: descriptor.type,
      label: descriptor.label,
      ownershipVerification: descriptor.ownershipVerification,
      requiresManualReview: descriptor.requiresManualReview,
      metrics: descriptor.metrics,
      naturalKey: descriptor.naturalKey,
    }));
  }

  async listCategories() {
    const rows = await this.categories.listAll();
    return rows.map(toCategoryView);
  }

  async getCategory(slug: string) {
    const category = await this.categories.findBySlug(slug);
    if (!category) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }
    const { children, ...rest } = category;
    return { ...toCategoryView(rest), children: children.map(toCategoryView) };
  }

  async createAsset(
    userId: string,
    dto: CreateAssetDto,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new ConflictException({
        code: 'SELLER_PROFILE_REQUIRED',
        message: 'Create a seller profile before adding digital assets',
      });
    }

    const validation = validateAssetMetadata(dto.type, dto.metadata);
    if (!validation.ok) {
      throw new BadRequestException({
        code: 'ASSET_METADATA_INVALID',
        message: 'Asset metadata failed validation',
        problems: validation.issues,
      });
    }

    const categoryId = await this.resolveCategoryId(dto.categoryId, dto.type);
    const slug = await this.uniqueSlug(dto.title);

    const asset = await this.assets.create({
      type: dto.type,
      slug,
      title: dto.title,
      summary: dto.summary,
      sellerId: seller.id,
      country: dto.country,
      currency: dto.currency,
      categoryId,
      metadata: toNestedMetadata(dto.type, validation.value, 'create'),
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'ASSET_CREATED',
      entityType: 'DigitalAsset',
      entityId: asset.id,
      after: { type: asset.type, title: asset.title, slug: asset.slug },
      ...meta,
    });

    return toAssetView(asset);
  }

  /** Owners always see their asset; others only once it is READY (drafts stay hidden). */
  async getAsset(assetId: string, requesterId: string): Promise<Record<string, unknown>> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }

    if (asset.status !== 'READY') {
      const seller = await this.sellers.findByUserId(requesterId);
      if (!seller || seller.id !== asset.sellerId) {
        // Do not leak the existence of another seller's draft.
        throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
      }
    }

    return toAssetView(asset);
  }

  async listMyAssets(userId: string): Promise<Record<string, unknown>[]> {
    const seller = await this.requireSeller(userId);
    const rows = await this.assets.listBySeller(seller.id);
    return rows.map(toAssetView);
  }

  async updateAsset(
    userId: string,
    assetId: string,
    dto: UpdateAssetDto,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const asset = await this.requireOwnedAsset(userId, assetId);
    if (asset.status === 'ARCHIVED') {
      throw new ConflictException({
        code: 'ASSET_ARCHIVED',
        message: 'Archived assets cannot be modified',
      });
    }

    const base: Prisma.DigitalAssetUpdateInput = {};
    if (dto.title !== undefined) {
      base.title = dto.title;
    }
    if (dto.summary !== undefined) {
      base.summary = dto.summary;
    }
    if (dto.currency !== undefined) {
      base.currency = dto.currency;
    }
    if (dto.categoryId !== undefined) {
      if (dto.categoryId === null) {
        base.category = { disconnect: true };
      } else {
        const categoryId = await this.resolveCategoryId(dto.categoryId, asset.type as AssetType);
        base.category = { connect: { id: categoryId as string } };
      }
    }

    let nested: Record<string, unknown> = {};
    if (dto.metadata !== undefined) {
      const validation = validateAssetMetadata(asset.type as AssetType, dto.metadata);
      if (!validation.ok) {
        throw new BadRequestException({
          code: 'ASSET_METADATA_INVALID',
          message: 'Asset metadata failed validation',
          problems: validation.issues,
        });
      }
      nested = toNestedMetadata(asset.type as AssetType, validation.value, 'update');
    }

    const result = await this.assets.updateWithVersion(asset.id, dto.expectedVersion, base, nested);
    if (!result.updated) {
      throw new ConflictException({
        code: 'VERSION_MISMATCH',
        message: 'Asset was modified by another request; reload and retry',
      });
    }

    const updated = await this.assets.findById(asset.id);
    if (!updated) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'ASSET_UPDATED',
      entityType: 'DigitalAsset',
      entityId: asset.id,
      before: { title: asset.title, status: asset.status },
      after: { title: updated.title, status: updated.status },
      ...meta,
    });

    return toAssetView(updated);
  }

  async markReady(
    userId: string,
    assetId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const asset = await this.requireOwnedAsset(userId, assetId);
    if (asset.status === 'ARCHIVED') {
      throw new ConflictException({
        code: 'ASSET_ARCHIVED',
        message: 'Archived assets cannot be published',
      });
    }
    if (asset.status === 'READY') {
      return toAssetView(asset); // idempotent
    }

    const updated = await this.assets.setStatus(asset.id, 'READY');
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'ASSET_MARKED_READY',
      entityType: 'DigitalAsset',
      entityId: asset.id,
      before: { status: 'DRAFT' },
      after: { status: 'READY' },
      ...meta,
    });
    return toAssetView(updated);
  }

  async archiveAsset(
    userId: string,
    assetId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const asset = await this.requireOwnedAsset(userId, assetId);
    if (asset.status === 'ARCHIVED') {
      return toAssetView(asset); // idempotent
    }

    const updated = await this.assets.setStatus(asset.id, 'ARCHIVED');
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'ASSET_ARCHIVED',
      entityType: 'DigitalAsset',
      entityId: asset.id,
      before: { status: asset.status },
      after: { status: 'ARCHIVED' },
      ...meta,
    });
    return toAssetView(updated);
  }

  private async requireSeller(userId: string) {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'No seller profile for this account',
      });
    }
    return seller;
  }

  /** Ownership is checked against the caller's seller profile (IDOR-safe: 404). */
  private async requireOwnedAsset(userId: string, assetId: string): Promise<AssetWithMetadata> {
    const seller = await this.sellers.findByUserId(userId);
    const asset = await this.assets.findById(assetId);
    if (!seller || !asset || asset.sellerId !== seller.id) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    return asset;
  }

  private async resolveCategoryId(
    categoryId: string | undefined,
    type: AssetType,
  ): Promise<string | undefined> {
    if (!categoryId) {
      return undefined;
    }
    const category = await this.categories.findById(categoryId);
    if (!category) {
      throw new BadRequestException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }
    if (category.assetTypes.length > 0 && !category.assetTypes.includes(type)) {
      throw new BadRequestException({
        code: 'CATEGORY_TYPE_MISMATCH',
        message: `Category "${category.slug}" does not accept ${type} assets`,
      });
    }
    return category.id;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `${base}-${randomUUID().slice(0, 8)}`;
      const existing = await this.assets.findBySlug(candidate);
      if (!existing) {
        return candidate;
      }
    }
    return `${base}-${randomUUID()}`;
  }
}

export function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized || 'asset').slice(0, 60);
}

export function toCategoryView(category: {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  assetTypes: string[];
  sort: number;
}) {
  return {
    id: category.id,
    parentId: category.parentId,
    slug: category.slug,
    name: category.name,
    assetTypes: category.assetTypes,
    sort: category.sort,
  };
}

/** Flattens the single type-specific metadata relation and makes it JSON-safe. */
export function toAssetView(asset: AssetWithMetadata): Record<string, unknown> {
  const record = asset as unknown as Record<string, unknown>;
  const metadata = METADATA_KEYS.map((key) => record[key]).find((value) => value != null);

  return {
    id: asset.id,
    type: asset.type,
    slug: asset.slug,
    title: asset.title,
    summary: asset.summary,
    sellerId: asset.sellerId,
    country: asset.country,
    currency: asset.currency,
    categoryId: asset.categoryId,
    status: asset.status,
    verificationStatus: asset.verificationStatus,
    qualityStatus: asset.qualityStatus,
    extra: serializeValue(asset.extra),
    version: asset.version,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    metadata: metadata ? serializeValue(metadata) : {},
  };
}
