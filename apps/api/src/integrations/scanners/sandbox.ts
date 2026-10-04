import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

import type { ObjectStorage } from '@fa/domain';
import { SANDBOX_LIMITS } from './scanner-types';

export interface ScannableObject {
  id: string;
  key: string;
  sizeBytes: bigint;
}

export interface SandboxFile {
  objectId: string;
  relPath: string;
  bytes: number;
}

export interface ScanSandbox {
  dir: string;
  files: SandboxFile[];
  dispose: () => Promise<void>;
}

export class SandboxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxLimitError';
  }
}

/**
 * Turns an object key into a SAFE relative path.
 * Defends against path traversal ("../..") and absolute keys — an attacker
 * controlling an upload must never be able to write outside the sandbox.
 */
export function safeRelativePath(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new SandboxLimitError(`Unsafe object key rejected: ${key}`);
  }
  const safe = segments.join('/') || 'payload';
  return posix.normalize(safe);
}

/**
 * Creates a bounded, disposable sandbox and materializes the uploaded objects
 * into it. Enforces ZIP-bomb-style limits BEFORE and AFTER transfer.
 */
export async function createScanSandbox(
  objects: ScannableObject[],
  storage: ObjectStorage,
): Promise<ScanSandbox> {
  if (objects.length === 0) {
    throw new SandboxLimitError('No objects to scan');
  }
  if (objects.length > SANDBOX_LIMITS.maxFiles) {
    throw new SandboxLimitError(`Too many files (limit ${SANDBOX_LIMITS.maxFiles})`);
  }

  const totalBytes = objects.reduce((sum, object) => sum + object.sizeBytes, 0n);
  if (totalBytes > BigInt(SANDBOX_LIMITS.maxTotalBytes)) {
    throw new SandboxLimitError(`Scan payload exceeds ${SANDBOX_LIMITS.maxTotalBytes} bytes`);
  }
  for (const object of objects) {
    if (object.sizeBytes > BigInt(SANDBOX_LIMITS.maxSingleFileBytes)) {
      throw new SandboxLimitError(`File ${object.key} exceeds the per-file limit`);
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'fa-scan-'));
  const files: SandboxFile[] = [];

  try {
    for (const object of objects) {
      const relPath = safeRelativePath(object.key);
      const absolute = join(dir, relPath);
      const download = await storage.createSignedDownloadUrl(object.key, 300);
      const response = await fetch(download.url);
      if (!response.ok) {
        throw new SandboxLimitError(
          `Could not materialize ${object.key} (HTTP ${response.status})`,
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > SANDBOX_LIMITS.maxSingleFileBytes) {
        throw new SandboxLimitError(
          `File ${object.key} exceeded the per-file limit during transfer`,
        );
      }

      await mkdir(join(absolute, '..'), { recursive: true });
      await writeFile(absolute, bytes);
      files.push({ objectId: object.id, relPath: relPath, bytes: bytes.length });
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  return {
    dir,
    files,
    dispose: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
