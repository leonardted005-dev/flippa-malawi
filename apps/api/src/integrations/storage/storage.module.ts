import { Global, Module } from '@nestjs/common';

import type { ObjectStorage } from '@fa/domain';

import { OBJECT_STORAGE } from '../../common/tokens';
import { S3ObjectStorage } from './s3-object-storage';

/**
 * Storage adapters behind the domain ObjectStorage port. Swapping R2/B2/Supabase
 * for another S3-compatible provider touches only this module.
 */
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: S3ObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
