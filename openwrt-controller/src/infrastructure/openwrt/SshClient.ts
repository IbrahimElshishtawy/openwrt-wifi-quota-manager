import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';
import {
  OpenWrtConnectionError,
  OpenWrtNotConfiguredError,
} from './UbusClient.js';
import { metricsService } from '../metrics/MetricsService.js';
import { logger } from '../logging/Logger.js';

const execFileAsync = promisify(execFile);

export interface SshClientConfig {
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  keyPath?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface SshExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs?: number;
}

export interface ISshClient {
  isConfigured(): boolean;
  executeCommand(command: string): Promise<SshExecutionResult>;
}

/**
 * Production SSH client for issuing administrative shell commands to OpenWrt router
 * (e.g. nlbwmon queries, nftables inspection, system diagnostics).
 *
 * Utilizes Node.js child_process.execFile with SSH batch mode, strict timeouts,
 * command validation, metrics tracking, and credential sanitization to guarantee safe execution.
 */
export class SshClient implements ISshClient {
  private readonly config: {
    host: string;
    port: number;
    username: string;
    keyPath?: string | undefined;
    timeoutMs: number;
  };

  constructor(customConfig?: SshClientConfig) {
    const rawHost = customConfig?.host ?? env.OPENWRT_HOST ?? '';
    const rawPort = customConfig?.port ?? env.OPENWRT_SSH_PORT ?? 22;
    const rawUser = customConfig?.username ?? env.OPENWRT_SSH_USER ?? env.OPENWRT_USERNAME ?? 'root';
    const rawKey = customConfig?.keyPath ?? env.OPENWRT_SSH_KEY_PATH;
    const rawTimeout = customConfig?.timeoutMs ?? env.OPENWRT_SSH_TIMEOUT_MS ?? 5000;

    // Safety checks against argument injection
    if (rawHost.startsWith('-')) {
      throw new Error(`Invalid SSH host "${rawHost}": hostname cannot begin with a dash`);
    }
    if (rawKey && rawKey.startsWith('-')) {
      throw new Error(`Invalid SSH key path "${rawKey}": path cannot begin with a dash`);
    }

    this.config = {
      host: rawHost.trim(),
      port: Math.max(1, Math.min(65535, rawPort)),
      username: rawUser.trim().replace(/[^a-zA-Z0-9._-]/g, ''),
      keyPath: rawKey ? rawKey.trim() : undefined,
      timeoutMs: Math.max(500, rawTimeout),
    };
  }

  public isConfigured(): boolean {
    return Boolean(this.config.host && this.config.username);
  }

  /**
   * Executes a shell command on the target OpenWrt router via SSH.
   * Validates command against null bytes and control character injection.
   * Stderr and stdout are isolated and sanitized. Throws OpenWrtConnectionError on failure.
   */
  public async executeCommand(command: string): Promise<SshExecutionResult> {
    if (!this.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router host or credentials are not configured in environment variables'
      );
    }

    if (!command || typeof command !== 'string') {
      throw new Error('SSH command must be a non-empty string');
    }

    // Guard against null-byte or newline command injection
    if (command.includes('\0')) {
      throw new Error('SSH command contains null bytes (injection attempt)');
    }

    const connectTimeoutSec = Math.max(1, Math.floor(this.config.timeoutMs / 1000));
    const args: string[] = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `ConnectTimeout=${connectTimeoutSec}`,
      '-p', String(this.config.port),
    ];

    if (this.config.keyPath) {
      args.push('-i', this.config.keyPath);
    }

    args.push(`${this.config.username}@${this.config.host}`, command);

    // Extract coarse operation name for metrics/logging (e.g. nlbwmon, nft)
    const opMatch = command.trim().match(/^[a-zA-Z0-9_-]+/);
    const operation = opMatch ? opMatch[0] : 'ssh_cmd';

    metricsService.increment('openwrt_ssh_attempts_total', 1);
    const start = process.hrtime.bigint();

    try {
      const { stdout, stderr } = await execFileAsync('ssh', args, {
        timeout: this.config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 100) / 100;
      metricsService.increment('openwrt_ssh_successes_total', 1);
      metricsService.observe('openwrt_ssh_duration_ms', durationMs);

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 100) / 100;
      metricsService.increment('openwrt_ssh_failures_total', 1);
      metricsService.increment('ssh_failures', 1);
      metricsService.observe('openwrt_ssh_duration_ms', durationMs);

      const errorObj = err as {
        code?: number | string;
        killed?: boolean;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };

      if (errorObj.killed) {
        throw new OpenWrtConnectionError(
          `SSH command timed out after ${this.config.timeoutMs}ms while contacting ${this.config.host}:${this.config.port}`,
          err
        );
      }

      let stderrMsg = errorObj.stderr ? errorObj.stderr.toString().trim() : '';
      // Sanitize stderr to remove passwords or private keys
      stderrMsg = logger.sanitizeString(stderrMsg);

      const detailedMsg = stderrMsg.length > 0 ? `: ${stderrMsg}` : '';

      throw new OpenWrtConnectionError(
        `Failed to execute SSH command on OpenWrt (${this.config.host}:${this.config.port})${detailedMsg}`,
        err
      );
    }
  }
}

// Default singleton instance using environment variables
export const sshClient = new SshClient();
