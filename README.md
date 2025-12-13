# SSH Remote Code

Execute code in a remote SSH sandbox with transparent function calling and TypeScript support.

## Features

- 🔐 SSH key authentication
- 🎯 Transparent remote function calls (call remote functions as if they were local)
- 📦 TypeScript support with type safety
- 📁 File upload/download via SFTP
- ⚡ Execute arbitrary code in remote sandbox
- 🖥️ Shell command execution
- 🔄 Connection management with error handling

## Installation

```bash
npm install ssh-remote-code
```

## Quick Start

### 1. Create a configuration file

```typescript
// config.ts
import { SshRemoteCodeConfig } from 'ssh-remote-code';

export const homeassConf: SshRemoteCodeConfig = {
  host: '192.168.1.100',
  username: 'user',
  privateKey: '/path/to/ssh/key', // or provide key content directly
  sandboxPath: '/home/user/sandbox',
  port: 22, // optional, defaults to 22
};
```

### 2. Use in your code

```typescript
import { SshRemoteCode } from 'ssh-remote-code';
import { homeassConf } from './config';

const homeassistant = new SshRemoteCode(homeassConf);
await homeassistant.connect();

// Import remote module and call functions
const remoteModule = await homeassistant.import('./remote-functions');
const result = await remoteModule.someFunction('arg1', 'arg2');

// Or execute code directly
const result2 = await homeassistant.execute('someFunction()');

// Disconnect when done
await homeassistant.disconnect();
```

## Configuration

The `SshRemoteCodeConfig` interface supports the following options:

```typescript
interface SshRemoteCodeConfig {
  host: string;              // SSH host IP or hostname (required)
  port?: number;            // SSH port (default: 22)
  username: string;         // SSH username (required)
  privateKey: string;       // SSH private key path or content (required if no password)
  password?: string;        // SSH password (required if no privateKey)
  sandboxPath: string;      // Path to sandbox directory on remote (required)
  connectTimeout?: number;  // Connection timeout in ms (default: 10000)
  readyTimeout?: number;    // Ready timeout in ms (default: 20000)
}
```

### Private Key Options

You can provide the private key in two ways:

1. **File path**: `privateKey: '/path/to/key'`
2. **Key content**: `privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...'`

## API Reference

### `SshRemoteCode`

Main class for SSH remote code execution.

#### Methods

##### `connect(): Promise<void>`

Establish SSH connection to the remote machine.

##### `disconnect(): Promise<void>`

Close SSH connection.

##### `isConnected(): boolean`

Check if connection is active.

##### `import<T>(modulePath: string): Promise<RemoteModule<T>>`

Import a remote module and return a proxy object. The proxy allows calling functions as if they were local.

**Parameters:**
- `modulePath`: Path to the module relative to `sandboxPath`

**Returns:** Proxy object that intercepts method calls

**Example:**
```typescript
const remoteModule = await homeassistant.import('./my-module');
const result = await remoteModule.myFunction('arg1', 'arg2');
```

##### `execute<T>(code: string): Promise<T>`

Execute arbitrary JavaScript code in the remote sandbox.

**Parameters:**
- `code`: JavaScript code to execute

**Returns:** Result of the execution

**Example:**
```typescript
const result = await homeassistant.execute('1 + 1');
```

##### `runCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }>`

Execute a shell command on the remote machine.

**Parameters:**
- `command`: Shell command to execute

**Returns:** Command output with stdout, stderr, and exit code

**Example:**
```typescript
const { stdout, stderr, code } = await homeassistant.runCommand('ls -la');
```

##### `uploadFile(localPath: string, remotePath: string): Promise<void>`

Upload a file to the remote machine via SFTP.

**Parameters:**
- `localPath`: Path to local file
- `remotePath`: Path on remote machine

**Example:**
```typescript
await homeassistant.uploadFile('./local-file.js', '/home/user/sandbox/file.js');
```

##### `downloadFile(remotePath: string, localPath: string): Promise<void>`

Download a file from the remote machine via SFTP.

**Parameters:**
- `remotePath`: Path on remote machine
- `localPath`: Path to save local file

**Example:**
```typescript
await homeassistant.downloadFile('/home/user/sandbox/file.js', './local-file.js');
```

## Remote Module Structure

Your remote sandbox should contain Node.js modules that export functions. For example:

```javascript
// /home/user/sandbox/remote-functions.js
module.exports = {
  someFunction: async (arg1, arg2) => {
    // Your code here
    return arg1 + arg2;
  },
  
  anotherFunction: (value) => {
    return value * 2;
  }
};
```

Then you can import and use it:

```typescript
const remoteModule = await homeassistant.import('./remote-functions');
const result = await remoteModule.someFunction('hello', 'world');
```

## Type Safety

The package is written in TypeScript and provides type safety for remote function calls. You can use generics to type your remote modules:

```typescript
interface MyRemoteModule {
  myFunction: (arg: string) => Promise<number>;
}

const remoteModule = await homeassistant.import<MyRemoteModule>('./my-module');
// TypeScript will now know the types of myFunction
const result: number = await remoteModule.myFunction('test');
```

## Requirements

- Node.js 14+ on both local and remote machines
- SSH access to remote machine
- Node.js installed in the remote sandbox directory

## License

MIT

