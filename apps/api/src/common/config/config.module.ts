import { Global, Module } from '@nestjs/common';

import { parseEnv, type AppEnv } from '@fa/config';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('APP_ENV');

/**
 * Validates process.env ONCE at startup and exposes the typed result.
 * Fails fast (throws) if configuration is missing/invalid.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => parseEnv(process.env),
    },
  ],
  exports: [APP_ENV],
})
export class AppConfigModule {}
