import { SshRemoteCode, SshRemoteCodeConfig } from '../src/index';

// Example configuration
const homeassConf: SshRemoteCodeConfig = {
  host: '192.168.1.100',
  username: 'user',
  privateKey: '/path/to/ssh/key', // or provide key content directly
  sandboxPath: '/home/user/sandbox',
  port: 22, // optional, defaults to 22
  streamRemoteLogs: true, // Stream remote console.log to local console
};

async function main() {
  // Create instance
  const homeassistant = new SshRemoteCode(homeassConf);

  try {
    // Connect to remote machine
    console.log('Connecting...');
    await homeassistant.connect();
    console.log('Connected!');

    // Example 1: Import and call remote module functions
    console.log('\n--- Example 1: Import remote module ---');
    const remoteModule = await homeassistant.import('./remote-functions');
    
    // Call functions as if they were local
    const result1 = await remoteModule.someFunction('arg1', 'arg2');
    console.log('Result:', result1);

    // Example 2: Execute arbitrary code
    console.log('\n--- Example 2: Execute code ---');
    const result2 = await homeassistant.execute('2 + 2');
    console.log('Result:', result2);

    // Example 3: Run shell commands
    console.log('\n--- Example 3: Run shell command ---');
    const { stdout, stderr, code } = await homeassistant.runCommand('ls -la');
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
    console.log('exit code:', code);

    // Example 4: Upload file
    console.log('\n--- Example 4: Upload file ---');
    await homeassistant.uploadFile('./local-file.js', '/home/user/sandbox/uploaded-file.js');
    console.log('File uploaded!');

    // Example 5: Download file
    console.log('\n--- Example 5: Download file ---');
    await homeassistant.downloadFile('/home/user/sandbox/remote-file.js', './downloaded-file.js');
    console.log('File downloaded!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Disconnect
    await homeassistant.disconnect();
    console.log('\nDisconnected');
  }
}

// Run example
if (require.main === module) {
  main().catch(console.error);
}

