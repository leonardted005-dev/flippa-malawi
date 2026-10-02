import { Module } from '@nestjs/common';

import { SellersModule } from '../sellers/sellers.module';
import { AssetTypesController, AssetsController, CategoriesController } from './catalog.controller';
import { AssetRepository, CategoryRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [SellersModule],
  controllers: [AssetTypesController, CategoriesController, AssetsController],
  providers: [CatalogService, AssetRepository, CategoryRepository],
  exports: [CatalogService, AssetRepository, CategoryRepository],
})
export class CatalogModule {}
