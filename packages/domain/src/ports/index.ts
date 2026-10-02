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

// ---------------------------------------------------------------------------
// Object storage (Phase 4)
// ---------------------------------------------------------------------------

export interface SignedUploadOptions {
  /** Only PUT is exposed to clients — never raw read/list access. */
  method: 'PUT';
  contentType: string;
  /** Seconds until the URL expires (short-lived by design). */
  expiresIn: number;
  metadata?: Record<string, string>;
}

export interface SignedUpload {
  uploadUrl: string;
  method: 'PUT';
  /** Headers the client MUST send (part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ImageInspection {
  format: 'jpeg' | 'png' | 'gif' | 'webp';
  width?: number;
  height?: number;
}

export interface ObjectInspection {
  contentType: string;
  sizeBytes: number;
  image?: ImageInspection;
}

/**
 * Object-storage port. Adapters: Cloudflare R2 / Backblaze B2 / Supabase
 * (all S3-compatible; Phase-4 adapter: S3 client against MinIO in dev).
 * Clients NEVER receive permanent credentials — only signed, short-lived URLs.
 */
export interface ObjectStorage {
  createSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload>;
  createSignedDownloadUrl(key: string, expiresIn: number): Promise<SignedDownload>;
  /** Server-side inspection (HEAD + bounded probe) after an upload completes. */
  inspect(key: string): Promise<ObjectInspection | null>;
  delete(key: string): Promise<void>;
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
