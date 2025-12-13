import { SshConnection } from './connection';
import { ExecutionResult } from './types';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Handles remote code execution in the sandbox
 */
export class RemoteExecutor {
  constructor(private connection: SshConnection, private sandboxPath: string) {}

  /**
   * Execute arbitrary code in the remote sandbox
   */
  async execute<T = any>(code: string): Promise<T> {
    // Create a wrapper script that executes the code in the sandbox
    const wrappedCode = this.wrapCode(code, this.sandboxPath);

    // Create a temporary script file on the remote machine
    const tempScriptPath = `/tmp/ssh-remote-code-${crypto.randomBytes(8).toString('hex')}.js`;

    try {
      // Upload the script to the remote machine
      const sftp = await this.connection.getSftp();
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(tempScriptPath);
        writeStream.on('close', () => {
          resolve();
        });
        writeStream.on('error', (err: Error) => {
          reject(err);
        });
        writeStream.end(wrappedCode, 'utf8');
      });

      // Execute the script
      const client = this.connection.getClient();
      return new Promise((resolve, reject) => {
        client.exec(`node ${tempScriptPath}`, (err, stream) => {
          if (err) {
            this.cleanupTempFile(tempScriptPath).catch(() => {});
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('close', async (code: string) => {
            // Clean up the temporary file
            await this.cleanupTempFile(tempScriptPath).catch(() => {});

            try {
              // Try to parse the result from stdout
              const result = this.parseResult(stdout, stderr);
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
        });
      });
    } catch (error) {
      await this.cleanupTempFile(tempScriptPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Execute a function call remotely
   */
  async executeFunction<T = any>(
    modulePath: string,
    functionName: string,
    args: any[]
  ): Promise<T> {
    // Serialize arguments as JSON string
    const serializedArgs = JSON.stringify(args);

    // Create code to import module and call function
    // Use JSON.stringify to safely embed strings
    // This code is a complete block that returns a promise, so we don't need to wrap it in an assignment
    const code = `(async () => {
      const path = require('path');
      const sandboxPath = ${JSON.stringify(this.sandboxPath)};
      const modulePath = path.resolve(sandboxPath, ${JSON.stringify(modulePath)});
      const module = require(modulePath);
      const func = module[${JSON.stringify(functionName)}] || module.default?.[${JSON.stringify(functionName)}];
      if (!func || typeof func !== 'function') {
        throw new Error('Function ' + ${JSON.stringify(functionName)} + ' not found in module ' + modulePath);
      }
      const args = ${serializedArgs};
      const result = func.apply(null, args);
      return Promise.resolve(result).then(r => ({ success: true, result: r })).catch(e => ({
        success: false,
        error: {
          message: e.message,
          stack: e.stack,
          name: e.name
        }
      }));
    })()`;

    const wrappedCode = this.wrapCode(code, this.sandboxPath);

    // Create a temporary script file on the remote machine
    const tempScriptPath = `/tmp/ssh-remote-code-${crypto.randomBytes(8).toString('hex')}.js`;

    try {
      // Upload the script to the remote machine
      const sftp = await this.connection.getSftp();
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(tempScriptPath);
        writeStream.on('close', () => {
          resolve();
        });
        writeStream.on('error', (err: Error) => {
          reject(err);
        });
        writeStream.end(wrappedCode, 'utf8');
      });

      // Execute the script
      const client = this.connection.getClient();
      return new Promise((resolve, reject) => {
        client.exec(`node ${tempScriptPath}`, (err, stream) => {
          if (err) {
            this.cleanupTempFile(tempScriptPath).catch(() => {});
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('close', async (code: number | null) => {
            // Clean up the temporary file
            await this.cleanupTempFile(tempScriptPath).catch(() => {});

            try {
              const result = this.parseResult(stdout, stderr);
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
        });
      });
    } catch (error) {
      await this.cleanupTempFile(tempScriptPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Wrap code to execute in sandbox directory
   * @param code - Code to wrap. If it's an expression (starts with '('), it will be assigned to result.
   *                If it's a statement block, it will be executed directly and should handle its own output.
   */
  private wrapCode(code: string, sandboxPath: string): string {
    // Use JSON.stringify to safely embed the sandbox path
    const safeSandboxPath = JSON.stringify(sandboxPath);
    // Remove leading/trailing whitespace from code to avoid issues
    const trimmedCode = code.trim();
    
    // Check if code is an expression (starts with '(' for IIFE, or is a simple value/function call)
    // If it starts with '(', it's likely an IIFE that returns a promise
    const isExpression = trimmedCode.startsWith('(') && trimmedCode.endsWith(')');
    
    const wrapped = `const path = require('path');
const fs = require('fs');
process.chdir(${safeSandboxPath});
(async () => {
  try {
    ${isExpression ? `const result = ${trimmedCode};` : trimmedCode}
    ${isExpression ? `const finalResult = await Promise.resolve(result);` : ''}
    ${isExpression ? `
    console.log(JSON.stringify({
      success: true,
      result: finalResult
    }));` : ''}
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    }));
    process.exit(1);
  }
})();
`;
    return wrapped;
  }

  /**
   * Clean up temporary script file
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      const client = this.connection.getClient();
      await new Promise<void>((resolve, reject) => {
        client.exec(`rm -f ${filePath}`, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      // Ignore cleanup errors
    }
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

