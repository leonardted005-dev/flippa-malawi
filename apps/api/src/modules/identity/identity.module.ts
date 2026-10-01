import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import {
  RefreshTokenRepository,
  UserRepository,
  VerificationTokenRepository,
} from './identity.repository';
import { IdentityService } from './identity.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, UserRepository, RefreshTokenRepository, VerificationTokenRepository],
  exports: [IdentityService, UserRepository],
})
export class IdentityModule {}
