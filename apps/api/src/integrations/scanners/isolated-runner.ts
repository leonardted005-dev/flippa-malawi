import { spawn } from 'node:child_process';

import { SANDBOX_LIMITS } from './scanner-types';

export interface RunCommandOptions {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/**
 * Runs an EXTERNAL scanner binary out-of-process with:
 *  - `shell: false` (no argument injection; args are passed as an array),
 *  - a scrubbed environment (only an explicit allowlist is inherited),
 *  - a hard timeout (SIGKILL on breach),
 *  - capped stdout/stderr (unbounded output is a DoS vector).
 *
 * Uploaded content is only ever READ by this process — never executed
 * (rules #16/#17). Scanning therefore never runs "inside" the API process;
 * this child is an isolated helper, and the whole flow moves to the
 * `scan-runner` worker in a later phase.
 */
export async function runIsolated(options: RunCommandOptions): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? SANDBOX_LIMITS.scanTimeoutMs;
  const maxOutput = options.maxOutputBytes ?? SANDBOX_LIMITS.maxOutputBytes;
  const startedAt = Date.now();

  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    SYSTEMROOT: process.env['SYSTEMROOT'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    USERPROFILE: process.env['USERPROFILE'],
    HOME: process.env['HOME'],
    LANG: 'C.UTF-8',
  };

  return new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(options.cmd, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const append = (chunk: string, which: 'stdout' | 'stderr'): void => {
      if (truncated) {
        return;
      }
      const target = which === 'stdout' ? stdout : stderr;
      if (target.length + chunk.length > maxOutput) {
        truncated = true;
        return;
      }
      if (which === 'stdout') {
        stdout += chunk;
      } else {
        stderr += chunk;
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => append(chunk, 'stdout'));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => append(chunk, 'stderr'));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
      });
    });
  });
}
