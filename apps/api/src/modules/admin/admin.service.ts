import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export interface AuditLogQuery {
  limit: number;
  cursor?: string;
  entityType?: string;
  action?: string;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(query: AuditLogQuery) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorType: row.actorType,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? last.id : null,
    };
  }
}
