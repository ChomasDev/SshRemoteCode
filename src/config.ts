import * as fs from 'fs';
import * as path from 'path';
import { err, ok, type Result, type RemoteError } from './types';

export interface SshRemoteCodeConfig {
  host: string;
  port?: number;
  username: string;
  privateKey: string;
  sandboxPath: string;
  password?: string;
  connectTimeout?: number;
  readyTimeout?: number;
  preBuildCommand?: boolean;
  preBuildCustomCommand?: string;
  streamRemoteLogs?: boolean;
}

export function validateConfig(config: SshRemoteCodeConfig): Result<SshRemoteCodeConfig, RemoteError> {
  if (!config.host) return err({ code: 'VALIDATION_ERROR', message: 'SSH host is required' });
  if (!config.username) return err({ code: 'VALIDATION_ERROR', message: 'SSH username is required' });
  if (!config.privateKey && !config.password) {
    return err({ code: 'VALIDATION_ERROR', message: 'Either privateKey or password must be provided' });
  }
  if (!config.sandboxPath) return err({ code: 'VALIDATION_ERROR', message: 'sandboxPath is required' });

  let privateKey = config.privateKey;
  if (config.privateKey && !config.privateKey.includes('-----BEGIN')) {
    const keyPath = path.resolve(config.privateKey);
    if (fs.existsSync(keyPath)) {
      privateKey = fs.readFileSync(keyPath, 'utf8');
    } else {
      return err({ code: 'VALIDATION_ERROR', message: `Private key file not found: ${keyPath}` });
    }
  }

  return ok({
    host: config.host,
    port: config.port || 22,
    username: config.username,
    privateKey: privateKey || '',
    password: config.password,
    sandboxPath: config.sandboxPath,
    connectTimeout: config.connectTimeout || 10000,
    readyTimeout: config.readyTimeout || 20000,
    preBuildCommand: config.preBuildCommand || false,
    preBuildCustomCommand: config.preBuildCustomCommand,
    streamRemoteLogs: config.streamRemoteLogs || false,
  });
}
