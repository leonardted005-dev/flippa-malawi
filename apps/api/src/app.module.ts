import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { CommonModule } from './common/common.module';
import { AppConfigModule } from './common/config/config.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { HealthModule } from './common/health/health.module';
import { RequestIdMiddleware } from './common/observability/request-id.middleware';
import { JwtAuthGuard, RolesGuard } from './common/security/guards';
import { PrismaModule } from './integrations/prisma/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IdentityModule } from './modules/identity/identity.module';
import { SellersModule } from './modules/sellers/sellers.module';

/**
 * Root module (modular monolith). Cross-cutting concerns are registered as
 * global providers; feature modules are added phase by phase.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CommonModule,
    HealthModule,
    IdentityModule,
    SellersModule,
    CatalogModule,
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
