import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { WatchlistsController } from './watchlists.controller';
import { WatchlistsService } from './watchlists.service';

@Module({
  imports: [CatalogModule],
  controllers: [WatchlistsController],
  providers: [WatchlistsService],
  exports: [WatchlistsService],
})
export class WatchlistsModule {}
