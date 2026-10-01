import { Controller, Get, Headers, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  createPayoutAccountSchema,
  createSellerSchema,
  updateSellerSchema,
  type CreatePayoutAccountDto,
  type CreateSellerDto,
  type UpdateSellerDto,
} from './sellers.dto';
import { SellersService } from './sellers.service';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /** Public pricing/limits reference — tier limits come from configuration. */
  @Public()
  @Get('tiers')
  listTiers() {
    return this.sellers.listTierPolicies();
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createSellerSchema) dto: CreateSellerDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.sellers.createSeller(user.id, dto, idempotencyKey, deriveRequestMeta(req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.getMySeller(user.id);
  }

  @Patch('me')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(updateSellerSchema) dto: UpdateSellerDto,
    @Req() req: Request,
  ) {
    return this.sellers.updateSeller(user.id, dto, deriveRequestMeta(req));
  }

  @Get('me/tier')
  tier(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.getPolicyForUser(user.id);
  }

  @Get('me/payout-accounts')
  payoutAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.listPayoutAccounts(user.id);
  }

  @Post('me/payout-accounts')
  addPayoutAccount(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createPayoutAccountSchema) dto: CreatePayoutAccountDto,
    @Req() req: Request,
  ) {
    return this.sellers.addPayoutAccount(user.id, dto, deriveRequestMeta(req));
  }
}
