import { SshConnection } from './connection';
import { ExecutionResult, Result, err, ok, type RemoteError } from './types';
import * as crypto from 'crypto';

const FUNCTION_RUNNER_SCRIPT = `
const path = require('path');
async function main() {
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
  try {
    const params = JSON.parse(input);
    const { sandboxPath, modulePath, functionName, args, streamLogs } = params;
    process.chdir(sandboxPath);
    if (streamLogs) {
      ['log','error','warn','info'].forEach((lvl) => {
        console[lvl] = (...logArgs) => process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: lvl, args: logArgs }) + '\\n');
      });
    }
    const fullModulePath = path.resolve(sandboxPath, modulePath);
    const mod = require(fullModulePath);
    const func = mod[functionName] || mod.default?.[functionName];
    if (!func || typeof func !== 'function') throw new Error('Function ' + functionName + ' not found in module ' + fullModulePath);
    const result = await Promise.resolve(func.apply(null, args));
    process.stdout.write(JSON.stringify({ success: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ success: false, error: { message: error.message, stack: error.stack, name: error.name } }));
    process.exit(1);
  }
}
main();
`;

const CODE_RUNNER_SCRIPT = `
const path = require('path');
const fs = require('fs');
const vm = require('vm');
async function main() {
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
  try {
    const params = JSON.parse(input);
    const { sandboxPath, code, streamLogs } = params;
    process.chdir(sandboxPath);
    const interceptedConsole = streamLogs ? {
      log: (...args) => process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'log', args }) + '\\n'),
      error: (...args) => process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'error', args }) + '\\n'),
      warn: (...args) => process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'warn', args }) + '\\n'),
      info: (...args) => process.stderr.write('__REMOTE_LOG__:' + JSON.stringify({ type: 'info', args }) + '\\n')
    } : console;
    const context = { require, process, console: interceptedConsole, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, clearImmediate, __dirname: sandboxPath, __filename: path.join(sandboxPath, '_remote_exec.js'), module: { exports: {} }, exports: {}, path, fs };
    vm.createContext(context);
    const wrappedCode = '(async () => { ' + code + ' })()';
    const result = await vm.runInContext(wrappedCode, context, { filename: '_remote_exec.js', timeout: 30000 });
    process.stdout.write(JSON.stringify({ success: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ success: false, error: { message: error.message, stack: error.stack, name: error.name } }));
    process.exit(1);
  }
}
main();
`;

export class RemoteExecutor {
  private runnerScriptPath: string | null = null;
  private codeRunnerScriptPath: string | null = null;

  constructor(private connection: SshConnection, private sandboxPath: string, private streamRemoteLogs = false) {}

  private async ensureCodeRunnerScript(): Promise<Result<string, RemoteError>> {
    if (this.codeRunnerScriptPath) return ok(this.codeRunnerScriptPath);
    const scriptPath = `/tmp/ssh-remote-code-runner-${crypto.randomBytes(8).toString('hex')}.js`;
    const sftpRes = await this.connection.getSftp();
    if (!sftpRes.ok) return sftpRes;

    const writeRes = await new Promise<Result<void, RemoteError>>((resolve) => {
      const ws = sftpRes.data.createWriteStream(scriptPath);
      ws.on('close', () => resolve(ok(undefined)));
      ws.on('error', (e: Error) => resolve(err({ code: 'EXECUTION_ERROR', message: 'Failed to upload code runner', details: e.message })));
      ws.end(CODE_RUNNER_SCRIPT, 'utf8');
    });
    if (!writeRes.ok) return writeRes;

    this.codeRunnerScriptPath = scriptPath;
    return ok(scriptPath);
  }

  private async ensureFunctionRunnerScript(): Promise<Result<string, RemoteError>> {
    if (this.runnerScriptPath) return ok(this.runnerScriptPath);
    const scriptPath = `/tmp/ssh-remote-func-runner-${crypto.randomBytes(8).toString('hex')}.js`;
    const sftpRes = await this.connection.getSftp();
    if (!sftpRes.ok) return sftpRes;

    const writeRes = await new Promise<Result<void, RemoteError>>((resolve) => {
      const ws = sftpRes.data.createWriteStream(scriptPath);
      ws.on('close', () => resolve(ok(undefined)));
      ws.on('error', (e: Error) => resolve(err({ code: 'EXECUTION_ERROR', message: 'Failed to upload function runner', details: e.message })));
      ws.end(FUNCTION_RUNNER_SCRIPT, 'utf8');
    });
    if (!writeRes.ok) return writeRes;

    this.runnerScriptPath = scriptPath;
    return ok(scriptPath);
  }

  async execute<T = any>(code: string): Promise<Result<T, RemoteError>> {
    const runner = await this.ensureCodeRunnerScript();
    if (!runner.ok) return runner;

    const clientRes = this.connection.getClient();
    if (!clientRes.ok) return clientRes;

    const params = JSON.stringify({ sandboxPath: this.sandboxPath, code, streamLogs: this.streamRemoteLogs });

    return new Promise((resolve) => {
      clientRes.data.exec(`node ${runner.data}`, (execErr, stream) => {
        if (execErr) return resolve(err({ code: 'EXECUTION_ERROR', message: 'Failed to start remote execution', details: String(execErr) }));

        let stdout = '';
        let stderr = '';
        stream.on('data', (d: Buffer) => (stdout += d.toString()));
        stream.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          if (this.streamRemoteLogs) this.processRemoteLogs(chunk);
        });
        stream.on('close', () => {
          const parsed = this.parseResult(stdout, this.filterLogLines(stderr));
          if (parsed.success) return resolve(ok(parsed.result as T));
          resolve(err({ code: 'EXECUTION_ERROR', message: parsed.error?.message || 'Execution failed', details: parsed.error }));
        });
        stream.write(params);
        stream.end();
      });
    });
  }

  async executeFunction<T = any>(modulePath: string, functionName: string, args: any[]): Promise<Result<T, RemoteError>> {
    const runner = await this.ensureFunctionRunnerScript();
    if (!runner.ok) return runner;

    const clientRes = this.connection.getClient();
    if (!clientRes.ok) return clientRes;

    const params = JSON.stringify({ sandboxPath: this.sandboxPath, modulePath, functionName, args, streamLogs: this.streamRemoteLogs });

    return new Promise((resolve) => {
      clientRes.data.exec(`node ${runner.data}`, (execErr, stream) => {
        if (execErr) return resolve(err({ code: 'EXECUTION_ERROR', message: 'Failed to start remote function execution', details: String(execErr) }));

        let stdout = '';
        let stderr = '';
        stream.on('data', (d: Buffer) => (stdout += d.toString()));
        stream.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          if (this.streamRemoteLogs) this.processRemoteLogs(chunk);
        });
        stream.on('close', () => {
          const parsed = this.parseResult(stdout, this.filterLogLines(stderr));
          if (parsed.success) return resolve(ok(parsed.result as T));
          resolve(err({ code: 'EXECUTION_ERROR', message: parsed.error?.message || 'Function execution failed', details: parsed.error }));
        });
        stream.write(params);
        stream.end();
      });
    });
  }

  private processRemoteLogs(chunk: string): void {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('__REMOTE_LOG__:')) continue;
      try {
        const logData = JSON.parse(line.substring('__REMOTE_LOG__:'.length));
        const prefix = '[Remote]';
        if (logData.type === 'log') console.log(prefix, ...logData.args);
        if (logData.type === 'error') console.error(prefix, ...logData.args);
        if (logData.type === 'warn') console.warn(prefix, ...logData.args);
        if (logData.type === 'info') console.info(prefix, ...logData.args);
      } catch {
        // ignore malformed logs
      }
    }
  }

  private filterLogLines(stderr: string): string {
    return stderr
      .split('\n')
      .filter((line) => !line.startsWith('__REMOTE_LOG__:'))
      .join('\n');
  }

  async cleanup(): Promise<Result<void, RemoteError>> {
    const clientRes = this.connection.getClient();
    if (!clientRes.ok) return clientRes;

    const files = [this.runnerScriptPath, this.codeRunnerScriptPath].filter(Boolean);
    for (const filePath of files) {
      await new Promise<void>((resolve) => {
        clientRes.data.exec(`rm -f ${filePath}`, () => resolve());
      });
    }

    this.runnerScriptPath = null;
    this.codeRunnerScriptPath = null;
    return ok(undefined);
  }

  private parseResult(stdout: string, stderr: string): ExecutionResult {
    const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return { success: false, error: { message: 'Unable to parse JSON payload from remote output' } };
      }
    }

    if (stderr) return { success: false, error: { message: stderr } };

    if (stdout.trim()) {
      try {
        return { success: true, result: JSON.parse(stdout.trim()) };
      } catch {
        return { success: true, result: stdout.trim() };
      }
    }

    return { success: true, result: undefined };
  }
}
