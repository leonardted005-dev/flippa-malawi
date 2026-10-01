/**
 * Shared API contract types (api <-> web). In later phases these are generated
 * from the OpenAPI document; for Phase 1 they describe only framework-level
 * responses (health/readiness). No marketplace business types live here yet.
 */

/**
 * Wire representation of money. ALWAYS integer minor units serialized as a
 * string (to avoid IEEE-754 precision loss) plus an ISO-4217 currency code.
 * Never a float, never locale-formatted.
 */
export interface MoneyDto {
  /** Integer minor units, base-10 string, e.g. "150000" === 1500.00 major units. */
  amountMinor: string;
  /** ISO-4217, uppercase, 3 letters, e.g. "ZMW", "USD". */
  currency: string;
}

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export type DependencyState = 'up' | 'down';

export interface ReadyResponse {
  status: HealthStatus;
  checks: Record<string, DependencyState>;
  timestamp: string;
}

/** RFC 7807 problem+json error body shape returned by the API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  /** Structured per-field validation failures (present for VALIDATION_ERROR). */
  problems?: Array<{ path: string; message: string }>;
}
