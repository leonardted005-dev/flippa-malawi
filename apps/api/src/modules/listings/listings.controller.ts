import { Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  apiCreateListingSchema,
  apiUpdateListingSchema,
  type ApiCreateListingDto,
  type ApiUpdateListingDto,
} from './listings.dto';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** Declared before `:id` so the static route wins. */
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.listings.myListings(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(apiCreateListingSchema) dto: ApiCreateListingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.listings.create(user.id, dto, idempotencyKey, deriveRequestMeta(req));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.listings.getListing(id, user);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(apiUpdateListingSchema) dto: ApiUpdateListingDto,
    @Req() req: Request,
  ) {
    return this.listings.update(user.id, id, dto, deriveRequestMeta(req));
  }

  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.listings.submit(user.id, id, deriveRequestMeta(req));
  }

  @Post(':id/pause')
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.listings.pause(user.id, id, deriveRequestMeta(req));
  }

  @Post(':id/resume')
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.listings.resume(user.id, id, deriveRequestMeta(req));
  }

  @Post(':id/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.listings.withdraw(user.id, id, deriveRequestMeta(req));
  }
}
