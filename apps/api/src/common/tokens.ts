/** Injection tokens for domain ports implemented by infrastructure adapters. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
/** Live evidence readers for verification challenges (Phase 8). */
export const DNS_EVIDENCE_READER = Symbol('DNS_EVIDENCE_READER');
export const HTTP_EVIDENCE_READER = Symbol('HTTP_EVIDENCE_READER');
