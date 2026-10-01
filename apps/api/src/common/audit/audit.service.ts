import { Injectable, Logger } from '@nestjs/common';
import type { AuditActorType } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';
import { getRequestId } from '../observability/request-context';

export interface AuditEntry {
  actorId?: string | null;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

/** Append-only audit trail. Never updates or deletes existing rows. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorType: entry.actorType,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          ipHash: entry.ipHash ?? null,
          userAgent: entry.userAgent ?? null,
          requestId: getRequestId() ?? null,
        },
      });
    } catch (error) {
      // Audit must never break the business operation, but a failure is loud.
      this.logger.error(
        `Failed to write audit entry action=${entry.action} entity=${entry.entityType}:${entry.entityId ?? '-'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
