import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, Roles, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { QualityService } from './quality.service';

const rescanSchema = z.object({
  objectIds: z.array(z.string().uuid()).min(1).max(20).optional(),
});
type RescanDto = z.output<typeof rescanSchema>;

/**
 * Quality control surface. Rescans are seller/admin only and write to the
 * audit trail; read endpoints expose redacted findings only.
 */
@Controller('assets/:assetId')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Post('rescan')
  rescan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @ZodBody(rescanSchema) dto: RescanDto,
    @Req() req: Request,
  ) {
    return this.quality.scanAsset(
      user.id,
      assetId,
      dto.objectIds,
      user.roles.includes('ADMIN'),
      deriveRequestMeta(req),
    );
  }

  @Get('quality')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    void user;
    return this.quality.getQuality(assetId);
  }

  @Roles('ADMIN')
  @Get('scans')
  scans(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    void user;
    return this.quality.listScans(assetId);
  }
}
