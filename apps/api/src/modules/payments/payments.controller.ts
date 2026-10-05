import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { RateLimit, RateLimitGuard } from '../../common/http/rate-limit.guard';
import { type RawBodyRequest } from '../../common/http/raw-body';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import { createPaymentIntentSchema, type CreatePaymentIntentDto } from './payments.dto';
import { PaymentsService } from './payments.service';

/**
 * Buyer payment surface + provider webhook receiver.
 *
 * The webhook handler is PUBLIC (providers are anonymous) but always
 * signature-gated: verification happens in the adapter over the RAW body
 * before anything else. A browser redirect is NEVER accepted as payment
 * state — see `sync` (rule #11).
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createPaymentIntentSchema) dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.payments.createIntent(
      user.id,
      dto.listingId,
      idempotencyKey,
      deriveRequestMeta(req),
    );
  }

  @Get('intents')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listMine(user.id);
  }

  @Get('intents/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.getIntent(user.id, id, user.roles.includes('ADMIN'));
  }

  /**
   * Redirect recovery: re-reads truth SERVER-SIDE from the provider.
   * The redirect's own query params/body are ignored entirely (rule #11).
   */
  @Post('intents/:id/sync')
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.payments.syncIntent(user.id, id, deriveRequestMeta(req));
  }

  @Public()
  @HttpCode(200) // webhook acknowledgements are 2xx-with-200 by contract
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowMs: 60_000 })
  @Post('webhooks/:provider')
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key.toLowerCase()] = value;
      } else if (Array.isArray(value)) {
        headers[key.toLowerCase()] = value.join(',');
      }
    }
    const verification = await this.payments.verifyInboundWebhook(provider, req.rawBody, headers);
    return this.payments.applyProviderEvent(provider, verification, deriveRequestMeta(req));
  }
}
