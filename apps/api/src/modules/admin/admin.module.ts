import { Module } from '@nestjs/common';

import { ListingsModule } from '../listings/listings.module';
import { SellersModule } from '../sellers/sellers.module';
import { VerificationModule } from '../verification/verification.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [SellersModule, ListingsModule, VerificationModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
