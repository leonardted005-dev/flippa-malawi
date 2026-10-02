import { Module } from '@nestjs/common';

import { SellersModule } from '../sellers/sellers.module';
import { UploadsController } from './uploads.controller';
import { StorageObjectRepository } from './uploads.repository';
import { UploadsService } from './uploads.service';

@Module({
  imports: [SellersModule],
  controllers: [UploadsController],
  providers: [UploadsService, StorageObjectRepository],
  exports: [UploadsService, StorageObjectRepository],
})
export class UploadsModule {}
