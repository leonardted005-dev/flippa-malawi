import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SellerProfile, type SellerTier } from '@prisma/client';
import { isUploadAllowed, resolvePlanPolicy, type PlanPolicy, type TierConfig } from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { FieldCipher } from '../../integrations/security/field-cipher';
import { UserRepository } from '../identity/identity.repository';
import { PayoutAccountRepository, SellerRepository, TierRepository } from './sellers.repository';
import type { CreatePayoutAccountDto, CreateSellerDto, UpdateSellerDto } from './sellers.dto';

const DEFAULT_TIER_CODE = 'FREE_CODER';

export interface SellerView {
  id: string;
  userId: string;
  displayName: string;
  country: string;
  tierCode: string;
  status: string;
  ratingAvgBp: number;
  ratingCount: number;
  payoutCurrency: string | null;
  version: number;
}

/** JSON-safe projection of a PlanPolicy (bigint values become strings). */
export interface PolicyResponse {
  code: string;
  name: string;
  commissionBps: number;
  storageQuotaBytes: string | null;
  maxUploadBytesPerFile: string;
  maxActiveListings: number | null;
  qualityQueue: string;
  verificationLevel: string;
  features: Record<string, boolean>;
}

export function serializePolicy(policy: PlanPolicy): PolicyResponse {
  return {
    code: policy.code,
    name: policy.name,
    commissionBps: policy.commissionBps,
    storageQuotaBytes:
      policy.storageQuotaBytes === null ? null : policy.storageQuotaBytes.toString(),
    maxUploadBytesPerFile: policy.maxUploadBytesPerFile.toString(),
    maxActiveListings: policy.maxActiveListings,
    qualityQueue: policy.qualityQueue,
    verificationLevel: policy.verificationLevel,
    features: policy.features,
  };
}

@Injectable()
export class SellersService {
  constructor(
    private readonly sellers: SellerRepository,
    private readonly tiers: TierRepository,
    private readonly payoutAccounts: PayoutAccountRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly cipher: FieldCipher,
  ) {}

  async createSeller(
    userId: string,
    dto: CreateSellerDto,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<SellerView> {
    const result = await this.idempotency.run(
      `sellers:create:${userId}`,
      idempotencyKey,
      IdempotencyService.hashRequest(dto),
      async () => {
        const tier = await this.tiers.findByCode(DEFAULT_TIER_CODE);
        if (!tier) {
          throw new ConflictException({
            code: 'TIER_CONFIG_MISSING',
            message: `Tier "${DEFAULT_TIER_CODE}" is not configured`,
          });
        }

        let seller: SellerProfile;
        try {
          seller = await this.sellers.create({
            userId,
            displayName: dto.displayName,
            country: dto.country,
            tierCode: tier.code,
            payoutCurrency: dto.payoutCurrency,
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException({
              code: 'ALREADY_SELLER',
              message: 'A seller profile already exists for this account',
            });
          }
          throw error;
        }
        await this.users.addRole(userId, 'SELLER');
        await this.audit.record({
          actorId: userId,
          actorType: 'USER',
          action: 'SELLER_CREATED',
          entityType: 'SellerProfile',
          entityId: seller.id,
          after: {
            displayName: seller.displayName,
            country: seller.country,
            tierCode: seller.tierCode,
          },
          ...meta,
        });

        return { statusCode: 201, body: toSellerView(seller) };
      },
    );

    return result.body;
  }

  async getMySeller(userId: string): Promise<SellerView> {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'No seller profile for this account',
      });
    }
    return toSellerView(seller);
  }

  async updateSeller(userId: string, dto: UpdateSellerDto, meta: RequestMeta): Promise<SellerView> {
    const seller = await this.requireSeller(userId);
    const patch: { displayName?: string; country?: string; payoutCurrency?: string } = {};
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.country !== undefined) patch.country = dto.country;
    if (dto.payoutCurrency !== undefined) patch.payoutCurrency = dto.payoutCurrency;

    const result = await this.sellers.updateWithVersion(seller.id, dto.expectedVersion, patch);
    if (result.count === 0) {
      throw new ConflictException({
        code: 'VERSION_MISMATCH',
        message: 'Seller profile was modified by another request; reload and retry',
      });
    }

    const updated = await this.sellers.findById(seller.id);
    if (!updated) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'SELLER_UPDATED',
      entityType: 'SellerProfile',
      entityId: seller.id,
      before: { displayName: seller.displayName, country: seller.country },
      after: patch,
      ...meta,
    });

    return toSellerView(updated);
  }

  /** Resolves the seller's tier limits/fees — the ONLY source of these values. */
  async getPolicyForUser(userId: string): Promise<PolicyResponse> {
    const seller = await this.requireSeller(userId);
    return serializePolicy(await this.resolveTier(seller.tierCode));
  }

  /** Server-side quota gate for uploads (per seller tier). */
  async assertUploadWithinQuota(userId: string, sizeBytes: number): Promise<PlanPolicy> {
    const seller = await this.requireSeller(userId);
    const policy = await this.resolveTier(seller.tierCode);
    if (!isUploadAllowed(policy, BigInt(sizeBytes))) {
      throw new BadRequestException({
        code: 'UPLOAD_QUOTA_EXCEEDED',
        message: `Upload exceeds the ${policy.code} tier limit of ${policy.maxUploadBytesPerFile.toString()} bytes`,
      });
    }
    return policy;
  }

  async listTierPolicies(): Promise<PolicyResponse[]> {
    const rows = await this.tiers.list();
    return rows.map((row) => serializePolicy(resolvePlanPolicy(toTierConfig(row))));
  }

  async changeTier(
    adminId: string,
    sellerId: string,
    tierCode: string,
    meta: RequestMeta,
  ): Promise<PolicyResponse> {
    const seller = await this.sellers.findById(sellerId);
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    const policy = await this.resolveTier(tierCode);
    if (seller.tierCode === tierCode) {
      return serializePolicy(policy);
    }

    await this.sellers.changeTier(sellerId, tierCode);
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: 'SELLER_TIER_CHANGED',
      entityType: 'SellerProfile',
      entityId: sellerId,
      before: { tierCode: seller.tierCode },
      after: { tierCode },
      ...meta,
    });

    return serializePolicy(policy);
  }

  async listPayoutAccounts(userId: string) {
    const seller = await this.requireSeller(userId);
    const accounts = await this.payoutAccounts.listBySeller(seller.id);
    return accounts.map(toPayoutAccountView);
  }

  async addPayoutAccount(userId: string, dto: CreatePayoutAccountDto, meta: RequestMeta) {
    const seller = await this.requireSeller(userId);
    const last4 = dto.accountRef.slice(-4);

    const account = await this.payoutAccounts.create({
      sellerId: seller.id,
      provider: dto.provider,
      accountRefEnc: this.cipher.encrypt(dto.accountRef),
      accountRefLast4: last4,
      country: dto.country,
      currency: dto.currency,
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'PAYOUT_ACCOUNT_ADDED',
      entityType: 'PayoutAccount',
      entityId: account.id,
      after: {
        provider: account.provider,
        last4,
        country: account.country,
        currency: account.currency,
      },
      ...meta,
    });

    return toPayoutAccountView(account);
  }

  private async requireSeller(userId: string): Promise<SellerProfile> {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'No seller profile for this account',
      });
    }
    return seller;
  }

  private async resolveTier(tierCode: string): Promise<PlanPolicy> {
    const tier = await this.tiers.findByCode(tierCode);
    if (!tier) {
      throw new NotFoundException({
        code: 'TIER_NOT_FOUND',
        message: `Unknown tier "${tierCode}"`,
      });
    }
    return resolvePlanPolicy(toTierConfig(tier));
  }
}

function toTierConfig(row: SellerTier): TierConfig {
  return {
    code: row.code,
    name: row.name,
    storageQuotaBytes: row.storageQuotaBytes,
    maxUploadBytesPerFile: row.maxUploadBytesPerFile,
    maxActiveListings: row.maxActiveListings,
    commissionBps: row.commissionBps,
    qualityQueue: row.qualityQueue,
    verificationLevel: row.verificationLevel,
    features: (row.features ?? {}) as Record<string, boolean>,
  };
}

function toSellerView(seller: SellerProfile): SellerView {
  return {
    id: seller.id,
    userId: seller.userId,
    displayName: seller.displayName,
    country: seller.country,
    tierCode: seller.tierCode,
    status: seller.status,
    ratingAvgBp: seller.ratingAvgBp,
    ratingCount: seller.ratingCount,
    payoutCurrency: seller.payoutCurrency,
    version: seller.version,
  };
}

function toPayoutAccountView(account: {
  id: string;
  provider: string;
  accountRefLast4: string | null;
  country: string;
  currency: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: account.id,
    provider: account.provider,
    accountRefLast4: account.accountRefLast4,
    country: account.country,
    currency: account.currency,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
  };
}
