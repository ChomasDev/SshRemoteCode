import { SshRemoteCode, SshRemoteCodeConfig } from '../src/index';

const homeassConf: SshRemoteCodeConfig = {
  host: '192.168.1.100',
  username: 'user',
  privateKey: '/path/to/ssh/key',
  sandboxPath: '/home/user/sandbox',
  port: 22,
  streamRemoteLogs: true,
};

async function main() {
  const sdkRes = SshRemoteCode.create(homeassConf);
  if (!sdkRes.ok) return console.error('Config error:', sdkRes.error);
  const homeassistant = sdkRes.data;

  const connected = await homeassistant.connect();
  if (!connected.ok) return console.error('Connect error:', connected.error);

  const remoteModuleRes = await homeassistant.import<any>('./remote-functions');
  if (!remoteModuleRes.ok) return console.error('Import error:', remoteModuleRes.error);

  const result1 = await remoteModuleRes.data.someFunction('arg1', 'arg2');
  console.log('Result 1:', result1);

  const result2 = await homeassistant.execute('2 + 2');
  console.log('Result 2:', result2);

  const cmd = await homeassistant.runCommand('ls -la');
  console.log('Command:', cmd);

  await homeassistant.disconnect();
}

main().catch(console.error);
