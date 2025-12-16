import { SshConnection } from './connection';
import { RemoteExecutor } from './executor';
import { RemoteProxy } from './proxy';
import { SshRemoteCodeConfig } from './config';
import { RemoteModule } from './types';

/**
 * Main class for SSH Remote Code execution
 * 
 * @example
 * ```typescript
 * const homeassistant = new SshRemoteCode({
 *   host: '192.168.1.100',
 *   username: 'user',
 *   privateKey: '/path/to/key',
 *   sandboxPath: '/home/user/sandbox'
 * });
 * 
 * await homeassistant.connect();
 * const remoteModule = await homeassistant.import('./remote-functions');
 * const result = await remoteModule.someFunction(arg1, arg2);
 * ```
 */
export class SshRemoteCode {
    private connection: SshConnection;
    private executor: RemoteExecutor;
    private sandboxPath: string;
    private buildCommand: string;
    private preBuildCommand: boolean;

    constructor(config: SshRemoteCodeConfig) {
        this.connection = new SshConnection(config);
        this.sandboxPath = config.sandboxPath;
        this.executor = new RemoteExecutor(
            this.connection, 
            this.sandboxPath, 
            config.streamRemoteLogs || false
        );

        this.buildCommand = config.preBuildCustomCommand ?? 'npm run build';
        this.preBuildCommand = config.preBuildCommand || false;
    }

    /**
     * Establish SSH connection
     */
    async connect(): Promise<void> {
        await this.connection.connect();
        if (this.preBuildCommand) {
            await this.connection.BuildSandbox(this.buildCommand);
        }
    }

    /**
     * Check if connection is active
     */
    isConnected(): boolean {
        return this.connection.isConnected();
    }

    /**
     * Import a remote module and return a proxy object
     * The proxy allows calling functions as if they were local
     * 
     * @param modulePath - Path to the module relative to sandboxPath
     * @returns Proxy object that intercepts method calls
     * 
     * @example
     * ```typescript
     * const remoteModule = await homeassistant.import('./my-module');
     * const result = await remoteModule.myFunction('arg1', 'arg2');
     * ```
     */
    async import<T = any>(modulePath: string): Promise<RemoteModule<T>> {
        if (!this.isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        const proxy = new RemoteProxy(this.executor, modulePath);
        return proxy.createProxy<T>();
    }

    /**
     * Execute arbitrary code in the remote sandbox
     * 
     * @param code - JavaScript code to execute
     * @returns Result of the execution
     * 
     * @example
     * ```typescript
     * const result = await homeassistant.execute('1 + 1');
     * ```
     */
    async execute<T = any>(code: string): Promise<T> {
        if (!this.isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        return this.executor.execute<T>(code);
    }

    /**
     * Execute a shell command on the remote machine
     * 
     * @param command - Shell command to execute
     * @returns Command output with stdout, stderr, and exit code
     * 
     * @example
     * ```typescript
     * const { stdout, stderr, code } = await homeassistant.runCommand('ls -la');
     * ```
     */
    async runCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
        if (!this.isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        return this.connection.executeCommand(command);
    }

    /**
     * Upload a file to the remote machine
     * 
     * @param localPath - Path to local file
     * @param remotePath - Path on remote machine
     * 
     * @example
     * ```typescript
     * await homeassistant.uploadFile('./local-file.js', '/home/user/sandbox/file.js');
     * ```
     */
    async uploadFile(localPath: string, remotePath: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        return this.connection.uploadFile(localPath, remotePath);
    }

    /**
     * Download a file from the remote machine
     * 
     * @param remotePath - Path on remote machine
     * @param localPath - Path to save local file
     * 
     * @example
     * ```typescript
     * await homeassistant.downloadFile('/home/user/sandbox/file.js', './local-file.js');
     * ```
     */
    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        return this.connection.downloadFile(remotePath, localPath);
    }

    /**
     * Close SSH connection
     */
    async disconnect(): Promise<void> {
        await this.connection.disconnect();
    }
}

// Export types
export { SshRemoteCodeConfig } from './config';
export { RemoteModule, RemoteFunction, ExecutionResult } from './types';

