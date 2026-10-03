import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { AssetRepository } from '../catalog/catalog.repository';
function toWatchlistView(watchlist: {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  items?: Array<{
    id: string;
    createdAt: Date;
    asset: {
      id: string;
      type: string;
      slug: string;
      title: string;
      country: string;
      verificationStatus: string;
    };
  }>;
}) {
  return {
    id: watchlist.id,
    name: watchlist.name,
    isDefault: watchlist.isDefault,
    createdAt: watchlist.createdAt.toISOString(),
    items: (watchlist.items ?? []).map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      asset: item.asset,
    })),
  };
}

@Injectable()
export class WatchlistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetRepository,
    private readonly audit: AuditService,
  ) {}

  /** Every buyer implicitly owns one default watchlist (lazily created). */
  async defaultWatchlist(userId: string) {
    const existing = await this.prisma.watchlist.findFirst({
      where: { buyerId: userId, isDefault: true },
      include: { items: { include: { asset: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (existing) {
      return { ...toWatchlistView(existing), replayed: true };
    }
    const created = await this.prisma.watchlist.create({
      data: { buyerId: userId, name: 'Saved', isDefault: true },
      include: { items: { include: { asset: true }, orderBy: { createdAt: 'desc' } } },
    });
    return { ...toWatchlistView(created), replayed: false };
  }

  async listMine(userId: string) {
    return this.defaultWatchlist(userId);
  }

  async getOwned(userId: string, watchlistId: string) {
    const watchlist = await this.requireOwned(userId, watchlistId);
    const withItems = await this.prisma.watchlist.findUnique({
      where: { id: watchlist.id },
      include: { items: { include: { asset: true }, orderBy: { createdAt: 'desc' } } },
    });
    return toWatchlistView(withItems ?? watchlist);
  }

  /**
   * Adds an asset to the watchlist. Idempotent: adding twice returns the same
   * row (unique constraint) instead of an error.
   */
  async addItem(userId: string, watchlistId: string, assetId: string, meta: RequestMeta) {
    const watchlist = await this.requireOwned(userId, watchlistId);
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.status !== 'READY') {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }

    const own = await this.prisma.sellerProfile.findFirst({ where: { userId } });
    if (own && own.id === asset.sellerId) {
      throw new ForbiddenException({
        code: 'SELLER_CANNOT_WATCH_OWN',
        message: 'Sellers cannot watch their own assets',
      });
    }

    const existing = await this.prisma.watchlistItem.findUnique({
      where: { watchlistId_assetId: { watchlistId: watchlist.id, assetId } },
      include: { asset: true },
    });
    if (existing) {
      return this.itemView(existing); // idempotent add
    }

    try {
      const item = await this.prisma.watchlistItem.create({
        data: { watchlistId: watchlist.id, assetId },
        include: { asset: true },
      });
      await this.audit.record({
        actorId: userId,
        actorType: 'USER',
        action: 'WATCHLIST_ITEM_ADDED',
        entityType: 'Watchlist',
        entityId: watchlist.id,
        after: { assetId },
        ...meta,
      });
      return this.itemView(item);
    } catch (error) {
      const isUnique =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002';
      if (!isUnique) {
        throw error;
      }
      const raced = await this.prisma.watchlistItem.findUnique({
        where: { watchlistId_assetId: { watchlistId: watchlist.id, assetId } },
        include: { asset: true },
      });
      if (!raced) {
        throw error;
      }
      return this.itemView(raced);
    }
  }

  async removeItem(userId: string, watchlistId: string, assetId: string) {
    const watchlist = await this.requireOwned(userId, watchlistId);
    await this.prisma.watchlistItem.deleteMany({
      where: { watchlistId: watchlist.id, assetId },
    });
    return { removed: true };
  }

  private async requireOwned(userId: string, watchlistId: string) {
    const watchlist = await this.prisma.watchlist.findUnique({ where: { id: watchlistId } });
    if (!watchlist || watchlist.buyerId !== userId) {
      throw new NotFoundException({ code: 'WATCHLIST_NOT_FOUND', message: 'Watchlist not found' });
    }
    return watchlist;
  }

  private itemView(item: {
    id: string;
    createdAt: Date;
    asset: {
      id: string;
      type: string;
      slug: string;
      title: string;
      country: string;
      verificationStatus: string;
    };
  }) {
    return {
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      asset: item.asset,
    };
  }
}
