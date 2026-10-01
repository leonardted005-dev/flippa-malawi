import { Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, Roles, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { changeTierSchema, type ChangeTierDto } from '../sellers/sellers.dto';
import { SellersService } from '../sellers/sellers.service';
import { AdminService } from './admin.service';

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly sellers: SellersService,
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
}
