import { type INestApplication } from '@nestjs/common';
import { json } from 'express';
import type { Request } from 'express';

/** Webhook handlers verify signatures over the RAW body — re-parsed JSON will NOT do. */
export type RawBodyRequest = Request & { rawBody?: Buffer };

const RAW_BODY_LIMIT = '1mb';

/**
 * Preserves the raw request body for signature verification. Registered
 * BEFORE Nest's own body parser, so the platform parser later skips an
 * already-parsed body (body-parser checks `req._body`) while `rawBody` stays
 * available to webhook handlers.
 */
export function attachRawBodyParser(app: INestApplication): void {
  app.use(
    json({
      limit: RAW_BODY_LIMIT,
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
}
