// SSH Connection Configuration
// Fill in your Ubuntu machine connection details here

import { SshRemoteCodeConfig } from '../dist';
import { HomeAssistantConfig } from './homeassistant-client';

export const ubuntuConfig: SshRemoteCodeConfig = {
  host: '192.168.1.65', // e.g., '192.168.1.100' or 'ubuntu.example.com'
  username: 'villafavero', // e.g., 'ubuntu' or 'user'
  privateKey: 'C:\\Users\\faver\\.ssh\\id_ed25519', // Windows path to your SSH private key
  // password: 'YOUR_PASSWORD', // Uncomment if using password instead of private key
  sandboxPath: '/home/villafavero/testcode/dist', // Path to sandbox directory on remote machine
  port: 22, // SSH port (default: 22)
  connectTimeout: 10000, // Connection timeout in ms
  readyTimeout: 20000, // Ready timeout in ms
  preBuildCommand: true,
  preBuildCustomCommand: 'npm install && npm run build',
  streamRemoteLogs: true,
};

// Home Assistant Configuration
// Get your access token from: Home Assistant -> Profile -> Long-lived access tokens
export const homeAssistantConfig: HomeAssistantConfig = {
  baseUrl: 'http://localhost:8123', // Home Assistant URL (use localhost if running on same machine, or use the VPS IP)
  accessToken: 'YOUR_HOME_ASSISTANT_ACCESS_TOKEN', // Replace with your long-lived access token
};

