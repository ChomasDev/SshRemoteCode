import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration for SSH Remote Code connection
 */
export interface SshRemoteCodeConfig {
  /** SSH host IP address or hostname */
  host: string;
  /** SSH port (default: 22) */
  port?: number;
  /** SSH username */
  username: string;
  /** SSH private key - can be file path or key content */
  privateKey: string;
  /** Path to the sandbox directory on the remote machine */
  sandboxPath: string;
  /** Optional password (if not using key) */
  password?: string;
  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;
  /** Ready timeout in milliseconds (default: 20000) */
  readyTimeout?: number;

  /** Pre build command to run before building the sandbox */
  preBuildCommand?: boolean;
  /** Pre build custom command to run before building the sandbox */
  preBuildCustomCommand?: string;
}

/**
 * Validates and normalizes the SSH Remote Code configuration
 */
export function validateConfig(config: SshRemoteCodeConfig): SshRemoteCodeConfig {
  if (!config.host) {
    throw new Error('SSH host is required');
  }
  if (!config.username) {
    throw new Error('SSH username is required');
  }
  if (!config.privateKey && !config.password) {
    throw new Error('Either privateKey or password must be provided');
  }
  if (!config.sandboxPath) {
    throw new Error('sandboxPath is required');
  }

  // Normalize private key - if it's a file path, read it
  let privateKey = config.privateKey;
  if (config.privateKey && !config.privateKey.includes('-----BEGIN')) {
    // Assume it's a file path
    const keyPath = path.resolve(config.privateKey);
    if (fs.existsSync(keyPath)) {
      privateKey = fs.readFileSync(keyPath, 'utf8');
    } else {
      throw new Error(`Private key file not found: ${keyPath}`);
    }
  }

  return {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    privateKey: privateKey || '',
    password: config.password,
    sandboxPath: config.sandboxPath,
    connectTimeout: config.connectTimeout || 10000,
    readyTimeout: config.readyTimeout || 20000,
  };
}

