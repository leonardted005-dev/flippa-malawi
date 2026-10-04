import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  openVerificationCaseSchema,
  submitKycSchema,
  type OpenVerificationCaseDto,
  type SubmitKycDto,
} from './verification.dto';
import { VerificationService } from './verification.service';

/**
 * Seller-side verification surface. Admin queue/decide/revoke routes live on
 * AdminController. Challenge tokens are issued once at creation and never
 * re-exposed on any read endpoint.
 */
@Controller()
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('verification/cases')
  open(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(openVerificationCaseSchema) dto: OpenVerificationCaseDto,
    @Req() req: Request,
  ) {
    return this.verification.openCase(user.id, dto, deriveRequestMeta(req));
  }

  @Get('assets/:assetId/verification/cases')
  myAssetCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    return this.verification.myAssetCases(user.id, assetId);
  }

  @Post('verification/cases/:id/check')
  check(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.verification.checkChallenge(user.id, id, deriveRequestMeta(req));
  }

  @Post('verification/cases/:id/kyc')
  submitKyc(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(submitKycSchema) dto: SubmitKycDto,
    @Req() req: Request,
  ) {
    return this.verification.submitKyc(user.id, id, dto, deriveRequestMeta(req));
  }
}
