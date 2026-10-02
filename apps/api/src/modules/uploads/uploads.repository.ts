import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../integrations/prisma/prisma.service';

@Injectable()
export class StorageObjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.storageObject.findFirst({ where: { id, deletedAt: null } });
  }

  create(input: {
    bucket: string;
    key: string;
    ownerType: string;
    ownerId: string;
    contentType: string;
    sizeBytes: bigint;
  }) {
    return this.prisma.storageObject.create({ data: input });
  }

  async updateInspection(
    id: string,
    data: {
      sizeBytes: bigint;
      width?: number;
      height?: number;
      imageFormat?: string;
      visibility: 'PRIVATE' | 'REVIEW' | 'DOWNLOADS';
    },
  ) {
    return this.prisma.storageObject.update({ where: { id }, data });
  }
}
