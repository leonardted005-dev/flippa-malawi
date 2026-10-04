import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, Roles, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { changeTierSchema, type ChangeTierDto } from '../sellers/sellers.dto';
import { SellersService } from '../sellers/sellers.service';
import { rejectListingSchema, type RejectListingDto } from '../listings/listings.dto';
import { ListingsService } from '../listings/listings.service';
import {
  decideVerificationCaseSchema,
  type DecideVerificationCaseDto,
} from '../verification/verification.dto';
import { VerificationService } from '../verification/verification.service';
import { AdminService } from './admin.service';

const verificationQueueSchema = z.object({
  status: z.enum(['OPEN', 'SUBMITTED']).optional(),
});

const revokeCaseSchema = z.object({ note: z.string().min(3).max(2000) });

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly sellers: SellersService,
    private readonly listings: ListingsService,
    private readonly verification: VerificationService,
  ) {}

  @Get('audit-logs')
  auditLogs(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
  ) {
    const parsed = Number(limit ?? '50');
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 50;
    return this.admin.listAuditLogs({ limit: safeLimit, cursor, entityType, action });
  }

  @Get('tiers')
  tiers() {
    return this.sellers.listTierPolicies();
  }

  @Patch('sellers/:id/tier')
  changeTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sellerId: string,
    @ZodBody(changeTierSchema) dto: ChangeTierDto,
    @Req() req: Request,
  ) {
    return this.sellers.changeTier(user.id, sellerId, dto.tierCode, deriveRequestMeta(req));
  }

  /** Listing review: PENDING_REVIEW -> ACTIVE. */
  @Patch('listings/:id/approve')
  approveListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.listings.approve(user.id, id, deriveRequestMeta(req));
  }

  /** Listing review: PENDING_REVIEW -> DRAFT with a mandatory reason. */
  @Patch('listings/:id/reject')
  rejectListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(rejectListingSchema) dto: RejectListingDto,
    @Req() req: Request,
  ) {
    return this.listings.reject(user.id, id, dto.reason, deriveRequestMeta(req));
  }

  /** Verification queue: OPEN/SUBMITTED cases oldest-first. */
  @Get('verification/queue')
  verificationQueue(@Query() query: Record<string, unknown>) {
    const parsed = verificationQueueSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_QUERY',
        message: 'Invalid queue query',
        problems: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return this.verification.adminQueue('', parsed.data.status);
  }

  /** Verification decision: approve (→ VERIFIED) or reject (note required). */
  @Patch('verification/cases/:id/decide')
  decideVerificationCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(decideVerificationCaseSchema) dto: DecideVerificationCaseDto,
    @Req() req: Request,
  ) {
    return this.verification.decide(user.id, id, dto, deriveRequestMeta(req));
  }

  /** Verification revocation: VERIFIED → UNVERIFIED with a mandatory reason. */
  @Patch('verification/cases/:id/revoke')
  revokeVerificationCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(revokeCaseSchema) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.verification.revoke(user.id, id, dto.note, deriveRequestMeta(req));
  }
}
