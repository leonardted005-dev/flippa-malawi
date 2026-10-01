/**
 * Ports (interfaces) owned by the domain. Adapters that implement them live in
 * infrastructure (apps/api/src/integrations/*), keeping the domain free of any
 * provider or framework dependency.
 */

/** Password hashing port. Phase-2 adapter: scrypt (node:crypto). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;
}

export interface NotificationMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Outbound notification transport port. Real providers (email/SMS/push) are
 * wired in later phases; the Phase-2 adapter only logs (never pretends to
 * deliver).
 */
export interface NotificationSender {
  readonly channel: 'email' | 'sms' | 'push';
  send(message: NotificationMessage): Promise<void>;
}
