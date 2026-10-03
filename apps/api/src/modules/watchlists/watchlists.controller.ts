import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Delete,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { WatchlistsService } from './watchlists.service';

const watchItemSchema = z.object({ assetId: z.string().uuid() });

@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.watchlists.defaultWatchlist(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.watchlists.getOwned(user.id, id);
  }

  @Post(':id/items')
  @HttpCode(HttpStatus.CREATED)
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(watchItemSchema) dto: { assetId: string },
    @Req() req: Request,
  ) {
    return this.watchlists.addItem(user.id, id, dto.assetId, deriveRequestMeta(req));
  }

  @Delete(':id/items/:assetId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    return this.watchlists.removeItem(user.id, id, assetId);
  }
}
