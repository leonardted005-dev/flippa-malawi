import { Injectable } from '@nestjs/common';
import type { PaymentStatus } from '@fa/domain';

import { PrismaService } from '../../integrations/prisma/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  get client() {
    return this.prisma;
  }

  createIntent(input: {
    provider: string;
    buyerId: string;
    listingId: string;
    amountMinor: bigint;
    currency: string;
    expiresAt?: Date | null;
  }) {
    return this.prisma.paymentIntent.create({
      data: { ...input, expiresAt: input.expiresAt ?? null },
    });
  }

  findIntentById(id: string) {
    return this.prisma.paymentIntent.findUnique({ where: { id } });
  }

  findIntentByProviderRef(provider: string, providerRef: string) {
    return this.prisma.paymentIntent.findFirst({ where: { provider, providerRef } });
  }

  listByBuyer(buyerId: string) {
    return this.prisma.paymentIntent.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Latest-first operator view (admin: payment monitoring). */
  listRecent(limit: number, cursor?: string) {
    return this.prisma.paymentIntent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  recordEvent(input: {
    provider: string;
    providerEventId: string;
    intentId?: string | null;
    payload: Record<string, unknown>;
    status?: 'RECEIVED' | 'PROCESSED' | 'DUPLICATE' | 'IGNORED';
  }) {
    return this.prisma.paymentEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        intentId: input.intentId ?? null,
        payload: input.payload as never,
        status: input.status ?? 'RECEIVED',
      },
    });
  }

  markEvent(intentEventId: string, status: 'PROCESSED' | 'DUPLICATE' | 'IGNORED') {
    return this.prisma.paymentEvent.update({
      where: { id: intentEventId },
      data: { status, processedAt: new Date() },
    });
  }

  async setStatus(id: string, status: PaymentStatus) {
    return this.prisma.paymentIntent.update({
      where: { id },
      data: { status, version: { increment: 1 } },
    });
  }
}
