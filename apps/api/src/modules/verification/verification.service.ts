import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import type { DnsEvidenceReader, HttpEvidenceReader } from '@fa/domain';
import {
  assertVerificationTransition,
  CHALLENGE_TTL_MS,
  deriveAssetVerificationStatus,
  MAX_VERIFICATION_ATTEMPTS,
  VERIFICATION_METHOD_BY_ASSET,
  type VerificationMethod,
} from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { DNS_EVIDENCE_READER, HTTP_EVIDENCE_READER } from '../../common/tokens';
import { hashChallengeToken } from '../../integrations/evidence/evidence-readers';
import { FieldCipher } from '../../integrations/security/field-cipher';
import { SellerRepository } from '../sellers/sellers.repository';
import type { DecideVerificationCaseDto, SubmitKycDto } from './verification.dto';
import { VerificationRepository } from './verification.repository';

/**
 * Asset verification + tiered seller KYC (Phase 8).
 *
 * Security posture (threat-model driven):
 * - Challenge TOKENS are secrets: only sha256 persists; plaintext is shown to
 *   the seller exactly once at issuance and never logged/audited.
 * - Checks run SERVER-SIDE against live DNS/HTTP evidence. Client claims
 *   ("I added the record") never decide anything — only observed facts do.
 * - `verificationStatus` on the asset is a derived projection written only
 *   here (approve/reject/expire paths), never from client input.
 * - Mutations take the case row lock (`SELECT … FOR UPDATE`) so concurrent
 *   check/decide requests cannot both succeed.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly cases: VerificationRepository,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
    private readonly cipher: FieldCipher,
    @Inject(DNS_EVIDENCE_READER) private readonly dns: DnsEvidenceReader,
    @Inject(HTTP_EVIDENCE_READER) private readonly http: HttpEvidenceReader,
  ) {}

  /**
   * Opens a verification case. ASSET cases require ownership of the asset;
   * SELLER cases cover tiered KYC (BASIC/ENHANCED/ENTERPRISE per tier config).
   */
  async openCase(
    userId: string,
    input: { assetId?: string; targetType: 'ASSET' | 'SELLER'; method: VerificationMethod },
    meta: RequestMeta,
  ) {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new ConflictException({
        code: 'SELLER_PROFILE_REQUIRED',
        message: 'Create a seller profile before requesting verification',
      });
    }
    if (input.targetType === 'SELLER') {
      return this.openSellerCase(seller.id, userId, input.method, meta);
    }
    if (!input.assetId) {
      throw new BadRequestException({
        code: 'ASSET_ID_REQUIRED',
        message: 'assetId is required for asset verification',
      });
    }
    return this.openAssetCase(seller.id, userId, input.assetId, input.method, meta);
  }

  private async openAssetCase(
    sellerId: string,
    userId: string,
    assetId: string,
    method: VerificationMethod,
    meta: RequestMeta,
  ) {
    const prisma = this.cases.client;
    const asset = await prisma.digitalAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: { website: true, domain: true },
    });
    // IDOR-safe: a foreign/missing asset is 404, never 403.
    if (!asset || asset.sellerId !== sellerId) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    this.assertMethodAllowed(asset.type, method);
    if (await this.hasActiveAssetCase(assetId)) {
      throw new ConflictException({
        code: 'VERIFICATION_ALREADY_OPEN',
        message: 'A verification case is already open for this asset',
      });
    }
    const domain = readDomainName(asset.type, asset);
    const issued = this.issueChallenge(asset.type, asset.id, domain, method);

    const result = await prisma.$transaction(async (tx) => {
      // Re-check under the asset lock: two concurrent opens cannot both win.
      await tx.$executeRaw`SELECT id FROM digital_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
      const raced = await tx.verificationCase.findFirst({
        where: { assetId, status: { in: ['OPEN', 'SUBMITTED'] } },
      });
      if (raced) {
        throw new ConflictException({
          code: 'VERIFICATION_ALREADY_OPEN',
          message: 'A verification case is already open for this asset',
        });
      }
      const created = await tx.verificationCase.create({
        data: { targetType: 'ASSET', assetId, method, expiresAt: issued.expiresAt },
      });
      let challengeId: string | null = null;
      if (issued.token) {
        const challenge = await tx.ownershipChallenge.create({
          data: {
            caseId: created.id,
            method,
            target: issued.target,
            tokenHash: hashChallengeToken(issued.token),
            expiresAt: issued.expiresAt,
          },
        });
        challengeId = challenge.id;
        await tx.verificationCase.update({
          where: { id: created.id },
          data: { challengeId: challenge.id },
        });
      }
      await tx.digitalAsset.update({
        where: { id: assetId },
        data: { verificationStatus: 'IN_REVIEW', version: { increment: 1 } },
      });
      return { kaseId: created.id, challengeId };
    });

    const kase = await prisma.verificationCase.findUniqueOrThrow({ where: { id: result.kaseId } });
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'VERIFICATION_CASE_OPENED',
      entityType: 'VerificationCase',
      entityId: kase.id,
      after: { assetId, method },
      ...meta,
    });
    // The token is returned ONCE. It is never persisted, logged, or audited.
    return {
      ...toCaseView(kase),
      challenge: result.challengeId
        ? {
            id: result.challengeId,
            method,
            target: issued.target,
            ...(issued.token ? { token: issued.token } : {}),
            expiresAt: issued.expiresAt.toISOString(),
          }
        : null,
    };
  }

  private async openSellerCase(
    sellerId: string,
    userId: string,
    method: VerificationMethod,
    meta: RequestMeta,
  ) {
    if (method !== 'MANUAL') {
      throw new BadRequestException({
        code: 'METHOD_NOT_ALLOWED',
        message: 'Seller KYC uses manual review; automated methods apply to assets',
      });
    }
    const open = await this.cases.listOpenCasesForSeller(sellerId);
    if (open.length > 0) {
      throw new ConflictException({
        code: 'VERIFICATION_ALREADY_OPEN',
        message: 'A KYC case is already open for this seller',
      });
    }
    const kase = await this.cases.client.verificationCase.create({
      data: {
        targetType: 'SELLER',
        sellerId,
        method: 'MANUAL',
        kycLevel: 'BASIC',
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
      },
    });
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'KYC_CASE_OPENED',
      entityType: 'VerificationCase',
      entityId: kase.id,
      after: { sellerId },
      ...meta,
    });
    return toCaseView(kase);
  }

  /**
   * Server-side proof check. Fetches LIVE evidence (DNS TXT / HTTP body) and
   * compares observed values against the stored hash. On success the
   * challenge is consumed and the case moves OPEN → SUBMITTED for admin
   * decision.
   */
  async checkChallenge(userId: string, caseId: string, meta: RequestMeta) {
    const prisma = this.cases.client;
    const kase = await this.requireOwnedCase(userId, caseId);
    if (kase.status !== 'OPEN') {
      throw new ConflictException({
        code: 'CASE_NOT_OPEN',
        message: `Case is ${kase.status}; only OPEN cases can be checked`,
      });
    }
    if (!kase.challengeId) {
      throw new BadRequestException({
        code: 'NO_ACTIVE_CHALLENGE',
        message: 'This case requires manual review — no automated challenge applies',
      });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM verification_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
      const fresh = await tx.verificationCase.findUnique({
        where: { id: caseId },
        include: { challenge: true },
      });
      if (!fresh || fresh.status !== 'OPEN' || !fresh.challenge) {
        throw new ConflictException({
          code: 'STATE_CHANGED',
          message: 'Case changed while the check was running; reload and retry',
        });
      }
      if (fresh.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new ConflictException({
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Attempt budget exhausted; open a new case',
        });
      }
      if (fresh.challenge.expiresAt.getTime() < Date.now()) {
        await this.expireCaseTx(tx, fresh.id, 'Challenge expired');
        return { matched: false as const, expired: true as const };
      }
      const matched = await this.observeProof(fresh.challenge);
      await tx.ownershipChallenge.update({
        where: { id: fresh.challenge.id },
        data: { attempts: { increment: 1 } },
      });
      await tx.verificationCase.update({
        where: { id: caseId },
        data: { attempts: { increment: 1 } },
      });
      if (!matched) {
        return { matched: false as const, expired: false as const };
      }
      await tx.ownershipChallenge.update({
        where: { id: fresh.challenge.id },
        data: { verifiedAt: new Date() },
      });
      assertVerificationTransition('OPEN', 'SUBMITTED');
      await tx.verificationCase.update({
        where: { id: caseId },
        data: { status: 'SUBMITTED', challengeId: null, version: { increment: 1 } },
      });
      return { matched: true as const, expired: false as const };
    });

    if (outcome.expired) {
      await this.audit.record({
        actorId: userId,
        actorType: 'USER',
        action: 'VERIFICATION_CASE_EXPIRED',
        entityType: 'VerificationCase',
        entityId: caseId,
        ...meta,
      });
      throw new ConflictException({
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge expired; open a new verification case',
      });
    }
    if (!outcome.matched) {
      await this.audit.record({
        actorId: userId,
        actorType: 'USER',
        action: 'VERIFICATION_CHECK_FAILED',
        entityType: 'VerificationCase',
        entityId: caseId,
        ...meta,
      });
      throw new ConflictException({
        code: 'PROOF_NOT_FOUND',
        message: 'Ownership proof not observed yet — publish the challenge and retry',
      });
    }
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'VERIFICATION_PROOF_OBSERVED',
      entityType: 'VerificationCase',
      entityId: caseId,
      ...meta,
    });
    const updated = await prisma.verificationCase.findUniqueOrThrow({ where: { id: caseId } });
    return toCaseView(updated);
  }

  /**
   * Submits tiered KYC answers. PII is AES-256-GCM encrypted at rest; document
   * images stay in private storage (only the object id is referenced). Moves
   * the case OPEN → SUBMITTED for admin decision.
   */
  async submitKyc(userId: string, caseId: string, dto: SubmitKycDto, meta: RequestMeta) {
    const prisma = this.cases.client;
    const kase = await this.requireOwnedCase(userId, caseId);
    if (kase.targetType !== 'SELLER') {
      throw new BadRequestException({
        code: 'NOT_A_KYC_CASE',
        message: 'KYC answers apply to seller verification cases only',
      });
    }
    if (kase.status !== 'OPEN') {
      throw new ConflictException({
        code: 'CASE_NOT_OPEN',
        message: `Case is ${kase.status}; only OPEN cases accept KYC answers`,
      });
    }
    if (kase.expiresAt.getTime() < Date.now()) {
      await this.expireCase(kase.id, userId, meta);
      throw new ConflictException({
        code: 'CASE_EXPIRED',
        message: 'Case expired; open a new one',
      });
    }
    for (const answer of dto.answers) {
      if (!answer.evidenceObjectId) {
        continue;
      }
      const object = await prisma.storageObject.findUnique({
        where: { id: answer.evidenceObjectId },
      });
      if (!object || object.ownerType !== 'SELLER' || object.ownerId !== kase.sellerId) {
        throw new BadRequestException({
          code: 'KYC_EVIDENCE_NOT_AVAILABLE',
          message: 'One or more evidence uploads are unavailable',
        });
      }
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM verification_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
      const fresh = await tx.verificationCase.findUnique({ where: { id: caseId } });
      if (!fresh || fresh.status !== 'OPEN' || fresh.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'VERSION_MISMATCH',
          message: 'Case changed; reload and retry',
        });
      }
      await tx.kycAnswer.deleteMany({ where: { caseId } });
      await tx.kycAnswer.createMany({
        data: dto.answers.map((answer) => ({
          caseId,
          question: answer.question,
          answerEnc: this.cipher.encrypt(answer.answer),
          hint: answer.answer.length > 4 ? `…${answer.answer.slice(-4)}` : undefined,
          evidenceObjectId: answer.evidenceObjectId ?? null,
        })),
      });
      assertVerificationTransition('OPEN', 'SUBMITTED');
      return tx.verificationCase.update({
        where: { id: caseId },
        data: { status: 'SUBMITTED', version: { increment: 1 } },
      });
    });
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'KYC_SUBMITTED',
      entityType: 'VerificationCase',
      entityId: caseId,
      after: { answers: dto.answers.length },
      ...meta,
    });
    return toCaseView(updated);
  }

  async adminQueue(adminId: string, status: 'OPEN' | 'SUBMITTED' | undefined) {
    void adminId;
    const rows = await this.cases.adminQueue(status, 50);
    const hasMore = rows.length > 50;
    const items = (hasMore ? rows.slice(0, 50) : rows).map((row) => ({
      ...toCaseView(row as unknown as Parameters<typeof toCaseView>[0]),
      asset: row.asset ? { id: row.asset.id, type: row.asset.type, title: row.asset.title } : null,
    }));
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? (last['id'] as string) : null };
  }

  /**
   * Admin decision. APPROVED writes the derived VERIFIED projection onto the
   * asset; REJECTED requires a note so the seller can act on it.
   */
  async decide(adminId: string, caseId: string, dto: DecideVerificationCaseDto, meta: RequestMeta) {
    const prisma = this.cases.client;
    const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    if (!kase) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Case not found' });
    }
    if (kase.status !== 'SUBMITTED' && kase.status !== 'OPEN') {
      throw new ConflictException({
        code: 'CASE_NOT_DECIDABLE',
        message: `Case is ${kase.status}; only OPEN/SUBMITTED cases can be decided`,
      });
    }
    if (dto.decision === 'REJECTED' && !dto.note) {
      throw new BadRequestException({
        code: 'REJECTION_NOTE_REQUIRED',
        message: 'A rejection note is required so the seller can act on it',
      });
    }
    const decided = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM verification_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
      const fresh = await tx.verificationCase.findUnique({ where: { id: caseId } });
      if (!fresh || (fresh.status !== 'SUBMITTED' && fresh.status !== 'OPEN')) {
        throw new ConflictException({
          code: 'STATE_CHANGED',
          message: 'Case changed while deciding; reload and retry',
        });
      }
      if (fresh.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'VERSION_MISMATCH',
          message: 'Case changed; reload and retry',
        });
      }
      const to = dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      assertVerificationTransition(fresh.status, to);
      const next = await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: to,
          decidedById: adminId,
          decidedAt: new Date(),
          decisionNote: dto.note ?? null,
          version: { increment: 1 },
        },
      });
      if (fresh.targetType === 'ASSET' && fresh.assetId) {
        await tx.digitalAsset.update({
          where: { id: fresh.assetId },
          data: {
            verificationStatus: deriveAssetVerificationStatus({ status: to }),
            version: { increment: 1 },
          },
        });
      }
      return next;
    });
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: dto.decision === 'APPROVED' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
      entityType: 'VerificationCase',
      entityId: caseId,
      before: { status: kase.status },
      after: { status: decided.status },
      ...meta,
    });
    return toCaseView(decided);
  }

  /** Admin revocation: drops the asset projection back to UNVERIFIED. */
  async revoke(adminId: string, caseId: string, note: string, meta: RequestMeta) {
    const prisma = this.cases.client;
    const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    if (!kase) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Case not found' });
    }
    if (kase.status !== 'APPROVED') {
      throw new ConflictException({
        code: 'CASE_NOT_REVOCABLE',
        message: 'Only APPROVED cases can be revoked',
      });
    }
    if (!note) {
      throw new BadRequestException({
        code: 'REVOCATION_NOTE_REQUIRED',
        message: 'A revocation reason is required',
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM verification_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
      await tx.verificationCase.update({
        where: { id: caseId },
        data: { status: 'REJECTED', decisionNote: note, version: { increment: 1 } },
      });
      if (kase.targetType === 'ASSET' && kase.assetId) {
        await tx.digitalAsset.update({
          where: { id: kase.assetId },
          data: { verificationStatus: 'UNVERIFIED', version: { increment: 1 } },
        });
      }
    });
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: 'VERIFICATION_REVOKED',
      entityType: 'VerificationCase',
      entityId: caseId,
      after: { note },
      ...meta,
    });
    return { id: caseId, status: 'REJECTED' as const };
  }

  async myAssetCases(userId: string, assetId: string) {
    const seller = await this.sellers.findByUserId(userId);
    const asset = await this.cases.client.digitalAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!seller || !asset || asset.sellerId !== seller.id) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    const rows = await this.cases.listCasesForAsset(assetId);
    // Challenge tokens are never re-exposed — only case metadata.
    return rows.map((row: Parameters<typeof toCaseView>[0]) => toCaseView(row));
  }

  private async requireOwnedCase(userId: string, caseId: string) {
    const seller = await this.sellers.findByUserId(userId);
    const kase = await this.cases.findCaseById(caseId);
    // IDOR-safe: foreign/missing cases are 404.
    if (!seller || !kase) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Case not found' });
    }
    const owned =
      (kase.targetType === 'ASSET' && kase.asset?.sellerId === seller.id) ||
      (kase.targetType === 'SELLER' && kase.sellerId === seller.id);
    if (!owned) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Case not found' });
    }
    return kase;
  }

  private async hasActiveAssetCase(assetId: string): Promise<boolean> {
    return (await this.cases.listOpenCasesForAsset(assetId)).length > 0;
  }

  private assertMethodAllowed(assetType: string, method: VerificationMethod): void {
    const allowed = VERIFICATION_METHOD_BY_ASSET[assetType] ?? ['MANUAL'];
    if (!allowed.includes(method)) {
      throw new BadRequestException({
        code: 'METHOD_NOT_ALLOWED',
        message: `${method} cannot verify ${assetType} assets`,
      });
    }
  }

  private issueChallenge(
    assetType: string,
    assetId: string,
    domain: string | null,
    method: VerificationMethod,
  ): { target: string; token: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS[method]);
    if (method === 'DNS_TXT' || method === 'HTTP_TOKEN') {
      if (!domain) {
        throw new BadRequestException({
          code: 'DOMAIN_REQUIRED',
          message: 'Asset metadata does not declare a verifiable domain',
        });
      }
      const token = randomBytes(32).toString('hex');
      const target =
        method === 'DNS_TXT'
          ? `_fa-verify.${domain}`.toLowerCase()
          : `https://${domain.toLowerCase()}/.well-known/fa-verification.txt`;
      return { target, token, expiresAt };
    }
    return { target: `${assetType}:${assetId}`, token: '', expiresAt };
  }

  private async observeProof(challenge: {
    method: VerificationMethod;
    target: string;
    tokenHash: string;
  }): Promise<boolean> {
    try {
      if (challenge.method === 'DNS_TXT') {
        const records = await this.dns.txtRecords(challenge.target);
        return records
          .flatMap((record) => record.values)
          .some((value) => hashChallengeToken(value.trim()) === challenge.tokenHash);
      }
      if (challenge.method === 'HTTP_TOKEN') {
        const page = await this.http.fetchText(challenge.target);
        if (page.status !== 200) {
          return false;
        }
        return page.body
          .split(/\s+/)
          .filter((candidate) => candidate.length >= 16)
          .some((candidate) => hashChallengeToken(candidate.trim()) === challenge.tokenHash);
      }
      return false;
    } catch {
      // ENOTFOUND / timeouts / refused fetches all mean "no proof observed".
      return false;
    }
  }

  private async expireCase(caseId: string, actorId: string, meta: RequestMeta) {
    await this.cases.client.$transaction(async (tx) => {
      await this.expireCaseTx(tx, caseId, 'Expired');
    });
    await this.audit.record({
      actorId,
      actorType: 'USER',
      action: 'VERIFICATION_CASE_EXPIRED',
      entityType: 'VerificationCase',
      entityId: caseId,
      ...meta,
    });
  }

  private async expireCaseTx(
    tx: Prisma.TransactionClient,
    caseId: string,
    reason: string,
  ): Promise<void> {
    const kase = await tx.verificationCase.findUnique({ where: { id: caseId } });
    if (!kase || kase.status === 'APPROVED' || kase.status === 'REJECTED') {
      return;
    }
    try {
      assertVerificationTransition(kase.status, 'EXPIRED');
    } catch {
      return;
    }
    await tx.verificationCase.update({
      where: { id: caseId },
      data: { status: 'EXPIRED', decisionNote: reason, version: { increment: 1 } },
    });
    if (kase.targetType === 'ASSET' && kase.assetId) {
      // Expiry clears IN_REVIEW but never strips an earned VERIFIED.
      const latest = await tx.verificationCase.findFirst({
        where: { assetId: kase.assetId, status: 'APPROVED' },
        orderBy: { decidedAt: 'desc' },
      });
      await tx.digitalAsset.update({
        where: { id: kase.assetId },
        data: {
          verificationStatus: latest ? 'VERIFIED' : 'UNVERIFIED',
          version: { increment: 1 },
        },
      });
    }
  }
}

function toCaseView(kase: {
  id: string;
  targetType: string;
  assetId: string | null;
  sellerId: string | null;
  method: string;
  kycLevel: string | null;
  status: string;
  attempts: number;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date;
  version: number;
  createdAt: Date;
}) {
  return {
    id: kase.id,
    targetType: kase.targetType,
    assetId: kase.assetId,
    sellerId: kase.sellerId,
    method: kase.method,
    kycLevel: kase.kycLevel,
    status: kase.status,
    attempts: kase.attempts,
    decidedAt: kase.decidedAt ? kase.decidedAt.toISOString() : null,
    decisionNote: kase.decisionNote,
    expiresAt: kase.expiresAt.toISOString(),
    version: kase.version,
    createdAt: kase.createdAt.toISOString(),
  };
}

/** Reads the verifiable domain from website/domain metadata relations. */
function readDomainName(
  assetType: string,
  asset: { website?: { domain: string } | null; domain?: { domainName: string } | null },
): string | null {
  const raw =
    assetType === 'WEBSITE'
      ? asset.website?.domain
      : assetType === 'DOMAIN'
        ? asset.domain?.domainName
        : null;
  if (!raw) {
    return null;
  }
  const domain = raw.trim().toLowerCase();
  // Fail closed on anything that is not a plausible registrable domain.
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.length > 253) {
    return null;
  }
  return domain;
}
