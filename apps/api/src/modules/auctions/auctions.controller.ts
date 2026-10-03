import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { RateLimit, RateLimitGuard } from '../../common/http/rate-limit.guard';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { placeBidSchema, type PlaceBidDto } from './auctions.dto';
import { AuctionsService } from './auctions.service';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.auctions.getAuction(id);
  }

  @Get(':id/bids')
  bids(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.auctions.bids(id, user);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @Post(':id/bids')
  placeBid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(placeBidSchema) dto: PlaceBidDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.auctions.placeBid(user.id, id, dto, deriveRequestMeta(req), idempotencyKey);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.auctions.close(user.id, id, deriveRequestMeta(req));
  }
}
