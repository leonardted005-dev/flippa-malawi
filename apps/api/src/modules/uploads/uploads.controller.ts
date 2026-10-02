import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { RateLimit, RateLimitGuard } from '../../common/http/rate-limit.guard';
import { CurrentUser, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { presignUploadSchema, type PresignUploadDto } from './uploads.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 60, windowMs: 60_000 })
  @Post('presign')
  presign(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(presignUploadSchema) dto: PresignUploadDto,
    @Req() req: Request,
  ) {
    return this.uploads.presign(user.id, dto, deriveRequestMeta(req));
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.uploads.complete(user.id, id, deriveRequestMeta(req));
  }

  @Get(':id/signed-url')
  signedUrl(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.uploads.signedUrl(user.id, id);
  }
}
