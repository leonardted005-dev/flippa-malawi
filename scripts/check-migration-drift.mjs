// CI hygiene: fails if the Prisma schema has drifted from the committed migrations.
// Cross-platform (Windows + POSIX). Requires SHADOW_DATABASE_URL to be set.
import { spawnSync } from 'node:child_process';

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error('[db:drift] SHADOW_DATABASE_URL is required (use a scratch database).');
  process.exit(2);
}

const cmd =
  'npx --no-install prisma migrate diff ' +
  '--from-migrations ./prisma/migrations ' +
  '--to-schema-datamodel ./prisma/schema.prisma ' +
  `--shadow-database-url "${shadow}" ` +
  '--exit-code';

const result = spawnSync(cmd, { stdio: 'inherit', shell: true, env: process.env });

if (result.status === 0) {
  console.log('[db:drift] No migration drift detected.');
  process.exit(0);
}

console.error('[db:drift] Migration drift detected (schema differs from migrations).');
process.exit(result.status ?? 1);
