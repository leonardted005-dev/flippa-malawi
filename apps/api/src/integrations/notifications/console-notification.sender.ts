import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage, NotificationSender } from '@fa/domain';

/**
 * Development / Phase-2 notification adapter.
 *
 * It does NOT deliver email — it only logs that a message WOULD be sent, so we
 * never pretend an external provider exists (see docs rule: no fake
 * functionality). A real provider adapter implementing NotificationSender is
 * wired in a later phase without touching callers.
 */
@Injectable()
export class ConsoleNotificationSender implements NotificationSender {
  readonly channel = 'email' as const;
  private readonly logger = new Logger('NotificationSender');

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(
      `NOT DELIVERED (dev adapter) -> to=${message.to} subject="${message.subject}" bodyLength=${message.body.length}`,
    );
  }
}
