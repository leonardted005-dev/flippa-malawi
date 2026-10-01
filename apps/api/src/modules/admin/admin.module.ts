import { Module } from '@nestjs/common';

import { SellersModule } from '../sellers/sellers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [SellersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
