import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { SshRemoteCodeConfig, validateConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages SSH connection lifecycle
 */
export class SshConnection {
  private client: Client;
  private config: SshRemoteCodeConfig;
  private connected: boolean = false;
  private connecting: boolean = false;

  constructor(config: SshRemoteCodeConfig) {
    this.config = validateConfig(config);
    this.client = new Client();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('error', (err) => {
      this.connected = false;
    });

    this.client.on('close', () => {
      this.connected = false;
    });

    this.client.on('end', () => {
      this.connected = false;
    });
  }

  /**
   * Establish SSH connection
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for ongoing connection attempt
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.connected) {
            clearInterval(checkInterval);
            resolve();
          } else if (!this.connecting) {
            clearInterval(checkInterval);
            reject(new Error('Connection failed'));
          }
        }, 100);
      });
    }

    this.connecting = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connecting = false;
        reject(new Error('Connection timeout'));
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
        resolve();
      });

      this.client.once('error', (err) => {
        clearTimeout(timeout);
        this.connecting = false;
        reject(err);
      });
    });
  }

  /**
   * Check if connection is active
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the SSH client instance
   */
  getClient(): Client {
    if (!this.connected) {
      throw new Error('SSH connection not established. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Get the sandbox path from config
   */
  getSandboxPath(): string {
    return this.config.sandboxPath;
  }

  /**
   * Execute a shell command
   */
  async executeCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const client = this.getClient();

    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number | null) => {
          resolve({ stdout, stderr, code });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Get SFTP client for file operations
   */
  async getSftp(): Promise<SFTPWrapper> {
    const client = this.getClient();

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(sftp);
      });
    });
  }

  /**
   * Upload a file to the remote machine
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const localFile = path.resolve(localPath);

    if (!fs.existsSync(localFile)) {
      throw new Error(`Local file not found: ${localFile}`);
    }

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(localFile);
      const writeStream = sftp.createWriteStream(remotePath);

      writeStream.on('close', () => {
        resolve();
      });

      writeStream.on('error', (err: Error) => {
        reject(err);
      });

      readStream.on('error', (err: Error) => {
        reject(err);
      });

      readStream.pipe(writeStream);
    });
  }

  /**
   * Download a file from the remote machine
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSftp();
    const localFile = path.resolve(localPath);
    const localDir = path.dirname(localFile);

    // Ensure local directory exists
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const readStream = sftp.createReadStream(remotePath);
      const writeStream = fs.createWriteStream(localFile);

      writeStream.on('close', () => {
        resolve();
      });

      writeStream.on('error', (err) => {
        reject(err);
      });

      readStream.on('error', (err: Error) => {
        reject(err);
      });

      readStream.pipe(writeStream);
    });
  }

  async BuildSandbox(buildCommand: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const path = this.getSandboxPath();
    const command = `cd ${path} && ${buildCommand}`;
    return this.executeCommand(command);
  }

  /**
   * Close SSH connection
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      return new Promise((resolve) => {
        this.client.end();
        this.client.once('close', () => {
          this.connected = false;
          resolve();
        });
      });
    }
  }
}

