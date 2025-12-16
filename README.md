# A New Execution Model for AI Agents
## Why MCP is the wrong abstraction — and what comes next

The Model Context Protocol (MCP) set out to connect AI models with external systems. What it accidentally did was turn the LLM itself into a state transport layer.

That is the fundamental mistake.

Every MCP interaction forces execution state to be serialized into tokens, passed through a neural network, and then reconstructed again. The model is no longer reasoning — it is acting as a lossy, expensive data bus.

This is not a tooling problem.
It is an execution model problem.

And it is why MCP collapses the moment workflows become real.

## The core insight: LLMs are compilers, not runtimes

LLMs are extraordinarily good at writing code.
They are not good at:

- **Shuttling intermediate state between tool calls**
- **Preserving execution context across turns**
- **Acting as a memory layer for files, processes, sockets, or connections**

MCP assumes the opposite.

It assumes the model should:

- **Call a tool**
- **Receive state as text**
- **Re-process that state**
- **Emit another tool call**
- **Repeat**

This forces every intermediate result through the neural network — even when the model is not reasoning about it.

That is pure waste.

Cloudflare reached the same conclusion from a different angle: agents do better when MCP tools are presented as a programming language API and the model writes code that calls it, instead of “tool calling” directly. See: [Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode/).

## The shift: move state out of the model entirely

The new model is simple — and obvious in hindsight:

- **The LLM writes code**
- **The code executes elsewhere**
- **State never goes back through the model unless explicitly needed**

This is not “better MCP”.
This is replacing MCP’s mental model altogether.

The LLM stops being:

- **A dispatcher**
- **A message broker**
- **A context store**

And becomes what it actually is:

- **A compiler targeting persistent execution environments**

## What this library is (and what’s actually new)

This repo provides a concrete, minimal execution substrate for that model:

- **A persistent *machine* environment** (files, installed deps, long-running services) accessed over SSH
- **A code-first interface**: TypeScript code and TypeScript interfaces, not “tool call tokens”
- **Transparent remote function calls**: `import()` a module from a remote sandbox and call its exported functions as if they were local

This is the key point:

- **The model writes TypeScript**
- **The TypeScript runs on a real machine**
- **Only final answers need to return to the model**

## TypeScript interfaces are the contract, not the prompt

Natural language descriptions are an interpretation tax.
Typed interfaces are not.

When an LLM sees a TypeScript interface, it is not guessing. It is recognizing a pattern it has seen thousands of times: optional fields, return types, overload-like shapes, unions, and generics.

- **MCP-style descriptions**: “Returns an object containing X, optionally Y...”
- **TypeScript interfaces**: the exact shape, in the native language of code

## Code examples

### Single machine (basic)

```ts
import { SshRemoteCode } from 'ssh-remote-code';

const vps = new SshRemoteCode({
  host: '192.168.1.65',
  username: 'villafavero',
  privateKey: 'C:\\Users\\faver\\.ssh\\id_ed25519',
  sandboxPath: '/home/villafavero/testcode/dist',
  preBuildCommand: true,
  preBuildCustomCommand: 'npm install && npm run build',
  streamRemoteLogs: true, // Stream remote console.log to local console
});

await vps.connect();

// Remote module must exist under sandboxPath (compiled JS)
const mod = await vps.import<{ add: (a: number, b: number) => Promise<number> }>('./index');
const sum = await mod.add(2, 3);
```

### Multiple machines (one config file)

```ts
// config.ts
import type { SshRemoteCodeConfig } from 'ssh-remote-code';

export const machines: Record<string, SshRemoteCodeConfig> = {
  build: {
    host: '10.0.0.10',
    username: 'ci',
    privateKey: 'C:\\Users\\me\\.ssh\\id_ed25519',
    sandboxPath: '/home/ci/sandbox',
    preBuildCommand: true,
    preBuildCustomCommand: 'npm ci && npm run build',
  },
  deploy: {
    host: '10.0.0.11',
    username: 'ops',
    privateKey: 'C:\\Users\\me\\.ssh\\id_ed25519',
    sandboxPath: '/home/ops/sandbox',
  },
  home: {
    host: '192.168.1.65',
    username: 'villafavero',
    privateKey: 'C:\\Users\\faver\\.ssh\\id_ed25519',
    sandboxPath: '/home/villafavero/testcode/dist',
  },
};
```

```ts
import { SshRemoteCode } from 'ssh-remote-code';
import { machines } from './config';

const build = new SshRemoteCode(machines.build);
const deploy = new SshRemoteCode(machines.deploy);
const home = new SshRemoteCode(machines.home);

await Promise.all([build.connect(), deploy.connect(), home.connect()]);

// Parallel execution across machines
const [artifact, status] = await Promise.all([
  build.runCommand('cd /home/ci/sandbox && npm run build:artifact'),
  deploy.runCommand('uname -a'),
]);

// A workflow that spans machines
if (artifact.code === 0) {
  await deploy.runCommand('cd /home/ops/sandbox && ./deploy.sh');
  await home.runCommand('echo "deploy done"'); // replace with your Home Assistant module calls
}
```

### Remote Console Logging

When developing or debugging remote functions, you can stream console output from the remote machine to your local console:

```ts
const vps = new SshRemoteCode({
  host: '192.168.1.65',
  username: 'villafavero',
  privateKey: 'C:\\Users\\faver\\.ssh\\id_ed25519',
  sandboxPath: '/home/villafavero/testcode/dist',
  streamRemoteLogs: true, // Enable log streaming
});

await vps.connect();

// Remote function with console.log statements
const mod = await vps.import<{ processData: (data: any) => Promise<void> }>('./dataProcessor');
await mod.processData({ id: 123 });

// Console output from remote machine will appear locally prefixed with [Remote]:
// [Remote] Processing data: { id: 123 }
// [Remote] Step 1 complete
// [Remote] Step 2 complete
```

**Features:**
- Captures `console.log`, `console.error`, `console.warn`, and `console.info` from remote code
- Streams output in real-time (not buffered until completion)
- Prefixes all remote logs with `[Remote]` to distinguish them from local logs
- Works for both `import()` module calls and `execute()` arbitrary code
- Zero performance impact when disabled (default: `false`)

### "The AI doesn't know it's calling other machines"

Once you expose everything as TypeScript interfaces, orchestration becomes regular code. The model writes code like:

```ts
const metrics = await analytics.getVpsMetrics({ window: '24h' });
if (metrics.errorRate > 0.05) {
  await deploy.rollback();
  await github.createIssue({ title: 'High error rate', body: JSON.stringify(metrics) });
}
```

Whether `analytics`, `deploy`, and `github` live on the same host, different SSH hosts, or different containers is an implementation detail the code can hide.

## How it works (high level)

- **`connect()`** opens an SSH connection; optionally runs a build command in the remote sandbox (`preBuildCommand`).
- **`import('./module')`** returns a local JS `Proxy` object. Every method call becomes a remote execution.
- **`execute(code)`** ships a JS snippet to the remote machine, runs it with Node, returns the parsed result.
- **`runCommand(cmd)`** runs an arbitrary shell command over SSH.

## How it works (under the hood, in this repo)

This section describes what the current implementation actually does.

### Remote module calls are a Proxy + “one-off node scripts”

1. **`SshRemoteCode.import()` creates a `RemoteProxy`**
   - The proxy intercepts property access (`proxy.someFunction`) and returns an async function.
2. **That async function calls `RemoteExecutor.executeFunction(modulePath, functionName, args)`**
3. **`RemoteExecutor` generates a temporary Node script**
   - It `require()`s the module from `sandboxPath + modulePath`
   - It finds the exported function by name
   - It calls it with JSON-serialized args
   - It prints a JSON envelope to stdout: `{ success, result }` (or `{ success:false, error }`)
4. **The script is uploaded via SFTP to `/tmp/ssh-remote-code-<random>.js`**
5. **The remote machine runs**: `node /tmp/ssh-remote-code-<random>.js`
6. **The client captures stdout/stderr, parses the JSON result, and returns it**
7. **The temp file is deleted**

### Important nuance: what is “persistent” today

With the current implementation, each `execute()` / remote function call runs as a fresh `node` process.

- **Persistent today**
  - **Remote filesystem** (artifacts, caches, logs)
  - **Installed dependencies** and toolchains
  - **External state** (databases, queues, HTTP services)
  - **Long-running processes started separately** (e.g., via `runCommand('nohup ... &')` or systemd)

- **Not persistent across calls (by default)**
  - **In-memory JS state inside a Node process**
  - **Module-level singletons that rely on the same Node runtime staying alive**

If you need “memory persistence”, you typically do it the way real systems do it: a daemon/service (DB, Redis, worker), or a long-running process you start and monitor.

## Why MCP breaks (in one paragraph)

MCP makes the LLM act like the runtime. Every intermediate result is shoved through the model so the model can emit the next call. That creates a neural-network bottleneck and pollutes the context window with state that should have lived in a machine.

This library’s stance is the opposite: let the model write code, let machines execute it, and let state live where state belongs.

## The open-source multiplier (what the community can add)

If the open-source community builds on this execution substrate, you can treat “other services” as just “other sandboxes”:

- **Small cloud sandboxes** (e.g., AWS/GCP/Azure) dedicated to analytics, scheduled jobs, or metrics collection
- **Deploy sandboxes** (e.g., Vercel/Netlify/Fly) that wrap provider APIs behind a stable TypeScript interface
- **Docker image sandboxes** that come with pre-installed clients for GitHub, Stripe, Slack, etc.

The endgame is a unified program surface:

- The AI writes TypeScript against interfaces.
- The execution hops across machines/containers transparently.
- The AI does not need to “know” which host executes which call.

## Summary

MCP was a first attempt.
This is the second.

And this time, the execution model matches how both LLMs and computers actually work.