// Fetches the external scanner binaries used by the quality engine.
// Run: node scripts/fetch-scanners.mjs
//
// Scanners are EXTERNAL tools (Phase 0.7) — they are downloaded, never vendored
// and never implemented by us. Outputs land in ./tools/ (gitignored).
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUnzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const GITLEAKS_VERSION = '8.21.2';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(repoRoot, 'tools');
const target = join(toolsDir, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');

if (existsSync(target)) {
  console.log(`[scanners] already present: ${target}`);
  process.exit(0);
}

mkdirSync(toolsDir, { recursive: true });

const isWindows = process.platform === 'win32';
const asset = isWindows
  ? `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`
  : process.arch === 'arm64'
    ? `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`
    : `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;

const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}`;
const archivePath = join(toolsDir, asset);

console.log(`[scanners] downloading ${url}`);
const response = await fetch(url);
if (!response.ok || !response.body) {
  console.error(`[scanners] download failed: ${response.status}`);
  process.exit(1);
}

await pipeline(response.body, createWriteStream(archivePath));

// Extract with the platform's own tooling (no extra dependencies).
const { spawnSync } = await import('node:child_process');
const unzip = isWindows
  ? spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force "${archivePath}" "${toolsDir}"`,
    ])
  : spawnSync('tar', ['-xzf', archivePath, '-C', toolsDir]);

if (unzip.status !== 0) {
  console.error(`[scanners] extraction failed: ${String(unzip.stderr)}`);
  process.exit(1);
}

if (isWindows) {
  const inner = join(toolsDir, `gitleaks_${GITLEAKS_VERSION}_windows_x64.exe`);
  if (existsSync(inner)) {
    renameSync(inner, target);
  }
}
try {
  unlinkSync(archivePath);
} catch {
  /* archive may already be gone */
}

const probe = spawnSync(target, ['version'], { encoding: 'utf8' });
console.log(`[scanners] ready: ${target} -> ${String(probe.stdout || probe.stderr).trim()}`);
