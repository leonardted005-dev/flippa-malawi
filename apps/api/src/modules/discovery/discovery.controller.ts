import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { Public } from '../../common/security/decorators';
import { ZodQuery } from '../../common/validation/zod.pipe';
import { discoveryQuerySchema, type DiscoveryQueryDto } from './discovery.dto';
import { DiscoveryService } from './discovery.service';

/**
 * Public marketplace read-model.
 *
 * Deliberately separate from `/listings` (seller management): discovery is
 * anonymous, ACTIVE-only and optimised for browsing, while `/listings/*`
 * requires authentication for ownership/management operations.
 */
@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('listings')
  browse(@ZodQuery(discoveryQuerySchema) query: DiscoveryQueryDto) {
    return this.discovery.browse(query);
  }

  @Public()
  @Get('listings/:id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.discovery.detail(id);
  }
}
