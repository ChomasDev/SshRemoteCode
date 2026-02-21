import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { SshRemoteCodeConfig, validateConfig } from './config';
import { err, ok, type RemoteError, type Result } from './types';
import * as fs from 'fs';
import * as path from 'path';

export class SshConnection {
  private client: Client;
  private config: SshRemoteCodeConfig;
  private connected = false;
  private connecting = false;

  private constructor(config: SshRemoteCodeConfig) {
    this.config = config;
    this.client = new Client();
    this.setupEventHandlers();
  }

  static create(config: SshRemoteCodeConfig): Result<SshConnection, RemoteError> {
    const validated = validateConfig(config);
    if (!validated.ok) return validated;
    return ok(new SshConnection(validated.data));
  }

  private setupEventHandlers(): void {
    this.client.on('error', () => {
      this.connected = false;
    });
    this.client.on('close', () => {
      this.connected = false;
    });
    this.client.on('end', () => {
      this.connected = false;
    });
  }

  async connect(): Promise<Result<void, RemoteError>> {
    if (this.connected) return ok(undefined);

    if (this.connecting) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.connected) {
            clearInterval(checkInterval);
            resolve(ok(undefined));
          } else if (!this.connecting) {
            clearInterval(checkInterval);
            resolve(err({ code: 'CONNECTION_ERROR', message: 'Connection failed while waiting for ongoing attempt' }));
          }
        }, 100);
      });
    }

    this.connecting = true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.connecting = false;
        resolve(err({ code: 'CONNECTION_ERROR', message: 'Connection timeout' }));
      }, this.config.connectTimeout);

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        privateKey: this.config.privateKey,
        password: this.config.password,
        readyTimeout: this.config.readyTimeout,
      };

      this.client.connect(connectConfig);

      this.client.once('ready', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.connecting = false;
        resolve(ok(undefined));
      });

      this.client.once('error', (e) => {
        clearTimeout(timeout);
        this.connecting = false;
        resolve(err({ code: 'CONNECTION_ERROR', message: 'SSH connection error', details: String(e) }));
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClient(): Result<Client, RemoteError> {
    if (!this.connected) return err({ code: 'NOT_CONNECTED', message: 'SSH connection not established. Call connect() first.' });
    return ok(this.client);
  }

  getSandboxPath(): string {
    return this.config.sandboxPath;
  }

  async executeCommand(command: string): Promise<Result<{ stdout: string; stderr: string; code: number | null }, RemoteError>> {
    const clientRes = this.getClient();
    if (!clientRes.ok) return clientRes;

    return new Promise((resolve) => {
      clientRes.data.exec(command, (execErr, stream) => {
        if (execErr) {
          resolve(err({ code: 'COMMAND_ERROR', message: 'Failed to start command', details: String(execErr) }));
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number | null) => resolve(ok({ stdout, stderr, code })));
        stream.on('data', (data: Buffer) => (stdout += data.toString()));
        stream.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
      });
    });
  }

  async getSftp(): Promise<Result<SFTPWrapper, RemoteError>> {
    const clientRes = this.getClient();
    if (!clientRes.ok) return clientRes;

    return new Promise((resolve) => {
      clientRes.data.sftp((sftpErr, sftp) => {
        if (sftpErr) return resolve(err({ code: 'CONNECTION_ERROR', message: 'Failed to open SFTP session', details: String(sftpErr) }));
        resolve(ok(sftp));
      });
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<Result<void, RemoteError>> {
    const sftpRes = await this.getSftp();
    if (!sftpRes.ok) return sftpRes;

    const localFile = path.resolve(localPath);
    if (!fs.existsSync(localFile)) {
      return err({ code: 'UPLOAD_ERROR', message: `Local file not found: ${localFile}` });
    }

    return new Promise((resolve) => {
      const readStream = fs.createReadStream(localFile);
      const writeStream = sftpRes.data.createWriteStream(remotePath);

      writeStream.on('close', () => resolve(ok(undefined)));
      writeStream.on('error', (e: Error) => resolve(err({ code: 'UPLOAD_ERROR', message: 'Upload failed', details: e.message })));
      readStream.on('error', (e: Error) => resolve(err({ code: 'UPLOAD_ERROR', message: 'Upload read failed', details: e.message })));

      readStream.pipe(writeStream);
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<Result<void, RemoteError>> {
    const sftpRes = await this.getSftp();
    if (!sftpRes.ok) return sftpRes;

    const localFile = path.resolve(localPath);
    const localDir = path.dirname(localFile);
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

    return new Promise((resolve) => {
      const readStream = sftpRes.data.createReadStream(remotePath);
      const writeStream = fs.createWriteStream(localFile);

      writeStream.on('close', () => resolve(ok(undefined)));
      writeStream.on('error', (e) => resolve(err({ code: 'DOWNLOAD_ERROR', message: 'Download write failed', details: String(e) })));
      readStream.on('error', (e: Error) => resolve(err({ code: 'DOWNLOAD_ERROR', message: 'Download read failed', details: e.message })));

      readStream.pipe(writeStream);
    });
  }

  async buildSandbox(buildCommand: string): Promise<Result<{ stdout: string; stderr: string; code: number | null }, RemoteError>> {
    const command = `cd ${this.getSandboxPath()} && ${buildCommand}`;
    return this.executeCommand(command);
  }

  async disconnect(): Promise<Result<void, RemoteError>> {
    if (!this.connected) return ok(undefined);

    return new Promise((resolve) => {
      this.client.end();
      this.client.once('close', () => {
        this.connected = false;
        resolve(ok(undefined));
      });
    });
  }
}
