import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';
import {
  OpenWrtConnectionError,
  OpenWrtNotConfiguredError,
} from './UbusClient.js';

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
}

export interface ISshClient {
  isConfigured(): boolean;
  executeCommand(command: string): Promise<SshExecutionResult>;
}

/**
 * Production SSH client for issuing administrative shell commands to OpenWrt router
 * (e.g. nlbwmon queries, nftables inspection, system diagnostics).
 *
 * Utilizes Node.js child_process.execFile with SSH batch mode and strict timeouts
 * to guarantee non-blocking asynchronous execution without external heavy dependencies.
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
    this.config = {
      host: customConfig?.host ?? env.OPENWRT_HOST ?? '',
      port: customConfig?.port ?? env.OPENWRT_SSH_PORT ?? 22,
      username: customConfig?.username ?? env.OPENWRT_SSH_USER ?? env.OPENWRT_USERNAME ?? 'root',
      keyPath: customConfig?.keyPath ?? env.OPENWRT_SSH_KEY_PATH,
      timeoutMs: customConfig?.timeoutMs ?? env.OPENWRT_SSH_TIMEOUT_MS ?? 5000,
    };
  }

  public isConfigured(): boolean {
    return Boolean(this.config.host && this.config.username);
  }

  /**
   * Executes a shell command on the target OpenWrt router via SSH.
   * Stderr and stdout are isolated. Throws OpenWrtConnectionError on failure.
   */
  public async executeCommand(command: string): Promise<SshExecutionResult> {
    if (!this.isConfigured()) {
      throw new OpenWrtNotConfiguredError(
        'OpenWrt router host or credentials are not configured in environment variables'
      );
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

    try {
      const { stdout, stderr } = await execFileAsync('ssh', args, {
        timeout: this.config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
      };
    } catch (err: unknown) {
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

      const stderrMsg = errorObj.stderr ? errorObj.stderr.toString().trim() : '';
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
