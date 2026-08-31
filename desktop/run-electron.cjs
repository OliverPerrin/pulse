const { spawn } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error('Unable to launch Pulse', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
