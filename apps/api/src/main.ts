import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AppEnv } from '@fa/config';

import { AppModule } from './app.module';
import { APP_ENV } from './common/config/config.module';
import { JsonLogger } from './common/observability/json-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger());

  const env = app.get<AppEnv>(APP_ENV);

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: env.WEB_BASE_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  Logger.log(
    `API listening on http://localhost:${env.API_PORT}/api/v1 (${env.NODE_ENV})`,
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  // Startup failure (e.g. invalid configuration) must fail loudly and exit.
  console.error(error);
  process.exit(1);
});
