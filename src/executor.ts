import { SshConnection } from './connection';
import { ExecutionResult } from './types';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Static runner script for safe function execution.
 * This script reads parameters from stdin as JSON, avoiding any code generation.
 */
const FUNCTION_RUNNER_SCRIPT = `
const path = require('path');

async function main() {
  // Read JSON params from stdin
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });

  try {
    const params = JSON.parse(input);
    const { sandboxPath, modulePath, functionName, args, streamLogs } = params;

    // Change to sandbox directory
    process.chdir(sandboxPath);

    // Intercept console.log if streaming is enabled
    if (streamLogs) {
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalInfo = console.info;
      
      console.log = (...logArgs) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'log', args: logArgs }) + '\\n');
      };
      console.error = (...logArgs) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'error', args: logArgs }) + '\\n');
      };
      console.warn = (...logArgs) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'warn', args: logArgs }) + '\\n');
      };
      console.info = (...logArgs) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'info', args: logArgs }) + '\\n');
      };
    }

    // Resolve and load the module
    const fullModulePath = path.resolve(sandboxPath, modulePath);
    const mod = require(fullModulePath);
    const func = mod[functionName] || mod.default?.[functionName];

    if (!func || typeof func !== 'function') {
      throw new Error('Function ' + functionName + ' not found in module ' + fullModulePath);
    }

    // Execute the function with provided arguments
    const result = await Promise.resolve(func.apply(null, args));

    // Use stdout for final result only
    process.stdout.write(JSON.stringify({
      success: true,
      result: result
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    }));
    process.exit(1);
  }
}

main();
`;

/**
 * Static runner script for executing arbitrary code safely.
 * The code is passed via stdin, not interpolated into the script.
 */
const CODE_RUNNER_SCRIPT = `
const path = require('path');
const fs = require('fs');
const vm = require('vm');

async function main() {
  // Read JSON params from stdin
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });

  try {
    const params = JSON.parse(input);
    const { sandboxPath, code, streamLogs } = params;

    // Change to sandbox directory
    process.chdir(sandboxPath);

    // Create intercepted console for logging
    const interceptedConsole = streamLogs ? {
      log: (...args) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'log', args }) + '\\n');
      },
      error: (...args) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'error', args }) + '\\n');
      },
      warn: (...args) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'warn', args }) + '\\n');
      },
      info: (...args) => {
        process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'info', args }) + '\\n');
      }
    } : console;

    // Create a context with common globals
    const context = {
      require,
      process,
      console: interceptedConsole,
      Buffer,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      setImmediate,
      clearImmediate,
      __dirname: sandboxPath,
      __filename: path.join(sandboxPath, '_remote_exec.js'),
      module: { exports: {} },
      exports: {},
      path,
      fs
    };

    // Execute code in VM context
    vm.createContext(context);
    
    // Wrap code to capture result
    const wrappedCode = '(async () => { ' + code + ' })()';
    const result = await vm.runInContext(wrappedCode, context, {
      filename: '_remote_exec.js',
      timeout: 30000
    });

    process.stdout.write(JSON.stringify({
      success: true,
      result: result
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    }));
    process.exit(1);
  }
}

main();
`;

/**
 * Handles remote code execution in the sandbox
 */
export class RemoteExecutor {
  private runnerScriptPath: string | null = null;
  private codeRunnerScriptPath: string | null = null;
  private streamRemoteLogs: boolean;

  constructor(
    private connection: SshConnection,
    private sandboxPath: string,
    streamRemoteLogs: boolean = false
  ) {
    this.streamRemoteLogs = streamRemoteLogs;
  }

  /**
   * Ensure the code runner script is uploaded to the remote machine
   */
  private async ensureCodeRunnerScript(): Promise<string> {
    if (this.codeRunnerScriptPath) {
      return this.codeRunnerScriptPath;
    }

    const scriptPath = `/tmp/ssh-remote-code-runner-${crypto.randomBytes(8).toString('hex')}.js`;
    const sftp = await this.connection.getSftp();

    await new Promise<void>((resolve, reject) => {
      const writeStream = sftp.createWriteStream(scriptPath);
      writeStream.on('close', () => resolve());
      writeStream.on('error', (err: Error) => reject(err));
      writeStream.end(CODE_RUNNER_SCRIPT, 'utf8');
    });

    this.codeRunnerScriptPath = scriptPath;
    return scriptPath;
  }

  /**
   * Ensure the function runner script is uploaded to the remote machine
   */
  private async ensureFunctionRunnerScript(): Promise<string> {
    if (this.runnerScriptPath) {
      return this.runnerScriptPath;
    }

    const scriptPath = `/tmp/ssh-remote-func-runner-${crypto.randomBytes(8).toString('hex')}.js`;
    const sftp = await this.connection.getSftp();

    await new Promise<void>((resolve, reject) => {
      const writeStream = sftp.createWriteStream(scriptPath);
      writeStream.on('close', () => resolve());
      writeStream.on('error', (err: Error) => reject(err));
      writeStream.end(FUNCTION_RUNNER_SCRIPT, 'utf8');
    });

    this.runnerScriptPath = scriptPath;
    return scriptPath;
  }

  /**
   * Execute arbitrary code in the remote sandbox
   * Code is passed as data via stdin, not interpolated into a script
   */
  async execute<T = any>(code: string): Promise<T> {
    const runnerPath = await this.ensureCodeRunnerScript();

    // Prepare params as JSON - code is DATA, not part of the script
    const params = JSON.stringify({
      sandboxPath: this.sandboxPath,
      code: code,
      streamLogs: this.streamRemoteLogs
    });

    const client = this.connection.getClient();
    return new Promise((resolve, reject) => {
      // Execute runner and pipe params via stdin
      client.exec(`node ${runnerPath}`, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          
          // Process log lines if streaming is enabled
          if (this.streamRemoteLogs) {
            this.processRemoteLogs(chunk);
          }
        });

        stream.on('close', async () => {
          try {
            // Filter out log lines from stderr before parsing
            const cleanStderr = this.filterLogLines(stderr);
            const result = this.parseResult(stdout, cleanStderr);
            if (result.success) {
              resolve(result.result as T);
            } else {
              const error = new Error(result.error?.message || 'Execution failed');
              if (result.error?.stack) {
                (error as any).stack = result.error.stack;
              }
              reject(error);
            }
          } catch (parseError) {
            reject(
              new Error(
                `Failed to parse execution result. stdout: ${stdout}, stderr: ${stderr}, parseError: ${parseError}`
              )
            );
          }
        });

        // Write params to stdin and close it
        stream.write(params);
        stream.end();
      });
    });
  }

  /**
   * Execute a function call remotely.
   * Uses a static runner script - function details are passed as JSON data, not code.
   */
  async executeFunction<T = any>(
    modulePath: string,
    functionName: string,
    args: any[]
  ): Promise<T> {
    const runnerPath = await this.ensureFunctionRunnerScript();

    // All parameters are passed as JSON data - no code interpolation
    const params = JSON.stringify({
      sandboxPath: this.sandboxPath,
      modulePath: modulePath,
      functionName: functionName,
      args: args,
      streamLogs: this.streamRemoteLogs
    });

    const client = this.connection.getClient();
    return new Promise((resolve, reject) => {
      // Execute runner and pipe params via stdin
      client.exec(`node ${runnerPath}`, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          
          // Process log lines if streaming is enabled
          if (this.streamRemoteLogs) {
            this.processRemoteLogs(chunk);
          }
        });

        stream.on('close', async () => {
          try {
            // Filter out log lines from stderr before parsing
            const cleanStderr = this.filterLogLines(stderr);
            const result = this.parseResult(stdout, cleanStderr);
            if (result.success) {
              resolve(result.result as T);
            } else {
              const error = new Error(result.error?.message || 'Function execution failed');
              if (result.error?.stack) {
                (error as any).stack = result.error.stack;
              }
              reject(error);
            }
          } catch (parseError) {
            reject(
              new Error(
                `Failed to parse function result. stdout: ${stdout}, stderr: ${stderr}, parseError: ${parseError}`
              )
            );
          }
        });

        // Write params to stdin and close it
        stream.write(params);
        stream.end();
      });
    });
  }

  /**
   * Process remote log output and print to local console
   */
  private processRemoteLogs(chunk: string): void {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('__REMOTE_LOG__:')) {
        try {
          const logData = JSON.parse(line.substring('__REMOTE_LOG__:'.length));
          const prefix = '[Remote]';
          
          switch (logData.type) {
            case 'log':
              console.log(prefix, ...logData.args);
              break;
            case 'error':
              console.error(prefix, ...logData.args);
              break;
            case 'warn':
              console.warn(prefix, ...logData.args);
              break;
            case 'info':
              console.info(prefix, ...logData.args);
              break;
          }
        } catch (e) {
          // Ignore malformed log lines
        }
      }
    }
  }

  /**
   * Filter out log lines from stderr
   */
  private filterLogLines(stderr: string): string {
    return stderr
      .split('\n')
      .filter(line => !line.startsWith('__REMOTE_LOG__:'))
      .join('\n');
  }

  /**
   * Clean up runner scripts from remote machine
   */
  async cleanup(): Promise<void> {
    const client = this.connection.getClient();
    const filesToClean = [this.runnerScriptPath, this.codeRunnerScriptPath].filter(Boolean);

    for (const filePath of filesToClean) {
      try {
        await new Promise<void>((resolve, reject) => {
          client.exec(`rm -f ${filePath}`, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    this.runnerScriptPath = null;
    this.codeRunnerScriptPath = null;
  }

  /**
   * Parse execution result from stdout/stderr
   */
  private parseResult(stdout: string, stderr: string): ExecutionResult {
    // Try to find JSON result in stdout
    const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Fall through to error handling
      }
    }

    // If no JSON result, check for errors
    if (stderr) {
      return {
        success: false,
        error: {
          message: stderr,
        },
      };
    }

    // If we have stdout but no JSON, return it as result
    if (stdout.trim()) {
      try {
        // Try to parse as JSON
        return { success: true, result: JSON.parse(stdout.trim()) };
      } catch {
        // Return as string
        return { success: true, result: stdout.trim() };
      }
    }

    return { success: true, result: undefined };
  }
}

