import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  createOfferSchema,
  rejectOfferSchema,
  type CreateOfferDto,
  type RejectOfferDto,
} from './offers.dto';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createOfferSchema) dto: CreateOfferDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.offers.create(user.id, dto, idempotencyKey, deriveRequestMeta(req));
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.listForBuyerView(user.id);
  }

  @Get('received')
  received(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.listReceivedView(user.id);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.offers.accept(user.id, id, deriveRequestMeta(req));
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = rejectOfferSchema.parse(body) as RejectOfferDto;
    return this.offers.reject(user.id, id, dto.reason, deriveRequestMeta(req));
  }

  @Post(':id/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.offers.withdraw(user.id, id, deriveRequestMeta(req));
  }
}
