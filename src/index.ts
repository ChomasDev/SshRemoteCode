import { SshConnection } from './connection';
import { RemoteExecutor } from './executor';
import { RemoteProxy } from './proxy';
import { SshRemoteCodeConfig } from './config';
import { RemoteModule, Result, err, ok, type RemoteError } from './types';

/**
 * Clean-architecture entry point.
 * - Infrastructure: SshConnection, RemoteExecutor
 * - Application façade: SshRemoteCode
 * - Contract style: Result<T,E> (never throw)
 */
export class SshRemoteCode {
  private connection: SshConnection;
  private executor: RemoteExecutor;
  private buildCommand: string;
  private preBuildCommand: boolean;

  private constructor(connection: SshConnection, config: SshRemoteCodeConfig) {
    this.connection = connection;
    this.executor = new RemoteExecutor(connection, config.sandboxPath, config.streamRemoteLogs || false);
    this.buildCommand = config.preBuildCustomCommand ?? 'npm run build';
    this.preBuildCommand = config.preBuildCommand || false;
  }

  static create(config: SshRemoteCodeConfig): Result<SshRemoteCode, RemoteError> {
    const connRes = SshConnection.create(config);
    if (!connRes.ok) return connRes;
    return ok(new SshRemoteCode(connRes.data, config));
  }

  async connect(): Promise<Result<void, RemoteError>> {
    const connected = await this.connection.connect();
    if (!connected.ok) return connected;
    if (!this.preBuildCommand) return ok(undefined);
    const build = await this.connection.buildSandbox(this.buildCommand);
    if (!build.ok) return build;
    if (build.data.code !== 0) {
      return err({ code: 'COMMAND_ERROR', message: 'Pre-build command failed', details: build.data });
    }
    return ok(undefined);
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  async import<T = any>(modulePath: string): Promise<Result<RemoteModule<T>, RemoteError>> {
    if (!this.isConnected()) return err({ code: 'NOT_CONNECTED', message: 'Not connected. Call connect() first.' });
    const proxy = new RemoteProxy(this.executor, modulePath);
    return ok(proxy.createProxy<T>());
  }

  async execute<T = any>(code: string): Promise<Result<T, RemoteError>> {
    if (!this.isConnected()) return err({ code: 'NOT_CONNECTED', message: 'Not connected. Call connect() first.' });
    return this.executor.execute<T>(code);
  }

  async runCommand(command: string): Promise<Result<{ stdout: string; stderr: string; code: number | null }, RemoteError>> {
    if (!this.isConnected()) return err({ code: 'NOT_CONNECTED', message: 'Not connected. Call connect() first.' });
    return this.connection.executeCommand(command);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<Result<void, RemoteError>> {
    if (!this.isConnected()) return err({ code: 'NOT_CONNECTED', message: 'Not connected. Call connect() first.' });
    return this.connection.uploadFile(localPath, remotePath);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<Result<void, RemoteError>> {
    if (!this.isConnected()) return err({ code: 'NOT_CONNECTED', message: 'Not connected. Call connect() first.' });
    return this.connection.downloadFile(remotePath, localPath);
  }

  async disconnect(): Promise<Result<void, RemoteError>> {
    const cleaned = await this.executor.cleanup();
    if (!cleaned.ok) return cleaned;
    return this.connection.disconnect();
  }
}

export { SshRemoteCodeConfig } from './config';
export { RemoteModule, RemoteFunction, ExecutionResult, Result, RemoteError } from './types';
