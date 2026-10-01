import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ConsoleNotificationSender } from '../integrations/notifications/console-notification.sender';
import { FieldCipher } from '../integrations/security/field-cipher';
import { ScryptPasswordHasher } from '../integrations/security/scrypt-password-hasher';
import { TokenService } from '../integrations/security/token.service';
import { AuditService } from './audit/audit.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { NOTIFICATION_SENDER, PASSWORD_HASHER } from './tokens';

/**
 * Cross-cutting services available application-wide: token signing, password
 * hashing, field encryption, notifications, audit trail and idempotency.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    TokenService,
    ScryptPasswordHasher,
    FieldCipher,
    ConsoleNotificationSender,
    AuditService,
    IdempotencyService,
    { provide: PASSWORD_HASHER, useExisting: ScryptPasswordHasher },
    { provide: NOTIFICATION_SENDER, useExisting: ConsoleNotificationSender },
  ],
  exports: [
    TokenService,
    ScryptPasswordHasher,
    FieldCipher,
    ConsoleNotificationSender,
    AuditService,
    IdempotencyService,
    PASSWORD_HASHER,
    NOTIFICATION_SENDER,
  ],
})
export class CommonModule {}
