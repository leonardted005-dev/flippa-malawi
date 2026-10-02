import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { CommonModule } from './common/common.module';
import { AppConfigModule } from './common/config/config.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { HealthModule } from './common/health/health.module';
import { RequestIdMiddleware } from './common/observability/request-id.middleware';
import { JwtAuthGuard, RolesGuard } from './common/security/guards';
import { PrismaModule } from './integrations/prisma/prisma.module';
import { StorageModule } from './integrations/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ListingsModule } from './modules/listings/listings.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { UploadsModule } from './modules/uploads/uploads.module';

/**
 * Root module (modular monolith). Cross-cutting concerns are registered as
 * global providers; feature modules are added phase by phase.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    CommonModule,
    HealthModule,
    IdentityModule,
    SellersModule,
    CatalogModule,
    ListingsModule,
    DiscoveryModule,
    UploadsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
