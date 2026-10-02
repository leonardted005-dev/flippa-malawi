import { Module } from '@nestjs/common';

import { ListingsModule } from '../listings/listings.module';
import { SellersModule } from '../sellers/sellers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [SellersModule, ListingsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
