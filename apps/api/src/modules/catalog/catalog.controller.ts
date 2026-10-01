import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  createAssetSchema,
  updateAssetSchema,
  type CreateAssetDto,
  type UpdateAssetDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

/** Reference data: which asset kinds exist and which metrics apply to each. */
@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  list() {
    return this.catalog.listAssetTypes();
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  list() {
    return this.catalog.listCategories();
  }

  @Public()
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.catalog.getCategory(slug);
  }
}

@Controller('assets')
export class AssetsController {
  constructor(private readonly catalog: CatalogService) {}

  /** Declared before `:id` so the static route wins. */
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.listMyAssets(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createAssetSchema) dto: CreateAssetDto,
    @Req() req: Request,
  ) {
    return this.catalog.createAsset(user.id, dto, deriveRequestMeta(req));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.getAsset(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(updateAssetSchema) dto: UpdateAssetDto,
    @Req() req: Request,
  ) {
    return this.catalog.updateAsset(user.id, id, dto, deriveRequestMeta(req));
  }

  @Post(':id/ready')
  ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.catalog.markReady(user.id, id, deriveRequestMeta(req));
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.catalog.archiveAsset(user.id, id, deriveRequestMeta(req));
  }
}
