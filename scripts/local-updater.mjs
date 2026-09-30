import { promises as fs, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.usagepulse.updater';
const APP_ID = 'com.usagepulse.desktop';
const STATE = path.join(os.homedir(), 'Library', 'Application Support', 'Pulse Updater');
const CONFIG = path.join(STATE, 'config.json');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = () => `gui/${process.getuid()}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
let activeChild = null;
let recovering = false;
let logFile = null;

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}
const exists = async file => fs.lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const hashFile = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (logFile) await fs.appendFile(logFile, line, { mode: 0o600 });
  else process.stdout.write(line);
}

export function validateSmoke(output) {
  const line = output.split('\n').find(line => line.startsWith('PULSE_SMOKE '));
  if (!line) throw new Error('Packaged smoke test did not report results');
  const result = JSON.parse(line.slice('PULSE_SMOKE '.length));
  for (const key of ['apiSnapshotValid', 'dashboardImagesLoaded', 'mainLoaded', 'trayLoaded', 'rendererSandboxed', 'liveSnapshotReady']) {
    if (result[key] !== true) throw new Error(`Packaged smoke check failed: ${key}`);
  }
  if (Object.entries(result).some(([key, value]) => key !== 'baseUrl' && value !== true)) throw new Error('A packaged smoke check failed');
  return result;
}

async function run(command, args = [], { cwd = STATE, timeout = 120000, env = process.env, allowFailure = false } = {}) {
  if (stopping && !recovering) throw new Error('Updater stopped');
  const childEnv = { ...env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;
    let output = '', timedOut = false, killTimer;
    const append = data => { output = (output + data.toString()).slice(-2_000_000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
    }, timeout);
    function done() { clearTimeout(timer); clearTimeout(killTimer); if (activeChild === child) activeChild = null; }
    child.on('error', error => { done(); reject(error); });
    child.on('close', (code, signal) => {
      done();
      if (code === 0 || (allowFailure && !timedOut)) resolve({ code, output });
      else reject(new Error(`${path.basename(command)} ${args[0] || ''} ${timedOut ? 'timed out' : `failed (${signal || code})`}\n${output.slice(-12000)}`));
    });
  });
}

export async function acquireLock(directory) {
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readJson(path.join(directory, 'owner.json'));
    if (owner && alive(owner.pid)) return null;
    // A fresh directory without its PID can be another process between mkdir
    // and write. Leave it alone instead of racing that owner.
    if (!owner && Date.now() - (await fs.stat(directory)).mtimeMs < 300000) return null;
    await fs.rm(directory, { recursive: true });
    return acquireLock(directory);
  }
  const token = randomUUID();
  await atomicJson(path.join(directory, 'owner.json'), { pid: process.pid, token });
  return async () => {
    const owner = await readJson(path.join(directory, 'owner.json'));
    if (owner?.token === token) await fs.rm(directory, { recursive: true });
  };
}

function paths(config) {
  const transactionDir = path.join(path.dirname(config.target), '.PulseUpdater');
  return {
    target: config.target, transactionDir,
    staged: path.join(transactionDir, 'staged.app'),
    backup: path.join(transactionDir, 'previous.app'),
    failed: path.join(transactionDir, 'failed.app'),
    journal: path.join(STATE, 'transaction.json'), receipt: path.join(STATE, 'installed.json')
  };
}
async function prepareTransactionDir(p) {
  if (await exists(p.transactionDir)) {
    const stat = await fs.lstat(p.transactionDir);
    if (stat.isSymbolicLink() || (await readJson(path.join(p.transactionDir, 'owner.json')))?.owner !== LABEL) throw new Error('Unrecognized updater staging directory');
  } else {
    await fs.mkdir(p.transactionDir, { mode: 0o700 });
    await atomicJson(path.join(p.transactionDir, 'owner.json'), { owner: LABEL });
  }
  if (await exists(p.target) && (await fs.lstat(p.target)).isSymbolicLink()) throw new Error('Refusing to replace a symlinked app');
}
async function appPids(target) {
  const executable = path.join(target, 'Contents', 'MacOS', 'Pulse');
  const { output } = await run('/bin/ps', ['-axo', 'pid=,command=']);
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && (match[2] === executable || match[2].startsWith(`${executable} `)) ? [Number(match[1])] : [];
  });
}
async function stopApp(target) {
  const pids = await appPids(target);
  for (const pid of pids) {
    if (!(await appPids(target)).includes(pid)) continue;
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await appPids(target)).length) return;
    await delay(100);
  }
  throw new Error('Pulse did not quit; leaving its bundle untouched');
}
async function verifyBundle(target) {
  const { output } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(target, 'Contents', 'Info.plist')]);
  if (output.trim() !== APP_ID) throw new Error(`Unexpected app identity at ${target}`);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
}
async function smoke(target) {
  const { output } = await run(path.join(target, 'Contents', 'MacOS', 'Pulse'), ['--smoke-test'], { timeout: 120000 });
  const result = validateSmoke(output);
  await log(`Smoke passed: ${JSON.stringify(result)}`);
}
async function launchApp(target, candidate = null) {
  const readyFile = path.join(STATE, `ready-${randomUUID()}.json`);
  const args = ['-a', target];
  if (candidate) args.push('--args', '--updater-ready-file', readyFile);
  try {
    await run('/usr/bin/open', args);
    for (let attempt = 0; attempt < (candidate ? 750 : 100); attempt++) {
      const pids = await appPids(target);
      if (!candidate && pids.length) return;
      if (candidate) {
        const ready = await readJson(readyFile);
        if (ready && pids.includes(ready.pid) && ready.commit === candidate.commit && ready.version === candidate.version) return;
      }
      await delay(100);
    }
    throw new Error(candidate ? 'Installed app did not acknowledge a live dashboard' : 'Previous app did not reopen');
  } finally { await fs.rm(readyFile, { force: true }); }
}
const realOps = { verify: verifyBundle, smoke, isRunning: async target => (await appPids(target)).length > 0, stop: stopApp, launch: launchApp };

export async function recoverTransaction(p, ops = realOps) {
  const journal = await readJson(p.journal);
  if (!journal) return false;
  recovering = true;
  try {
    if (journal.hadTarget === false) {
      await ops.stop(p.target);
      await fs.rm(p.failed, { recursive: true, force: true });
      if (await exists(p.target)) await fs.rename(p.target, p.failed);
    } else if (await exists(p.backup)) {
      await ops.stop(p.target);
      await fs.rm(p.failed, { recursive: true, force: true });
      if (await exists(p.target)) await fs.rename(p.target, p.failed);
      await fs.rename(p.backup, p.target);
      await ops.verify(p.target);
    } else if (!(await exists(p.target))) {
      throw new Error('Interrupted installation has neither an app nor a rollback copy');
    }
    if (journal.previousReceipt) await atomicJson(p.receipt, journal.previousReceipt);
    else await fs.rm(p.receipt, { force: true });
    if (journal.wasRunning) await ops.launch(p.target);
    await fs.rm(p.journal);
    await log('Restored previous Pulse installation');
    return true;
  } finally { recovering = false; }
}

export async function installPreparedBundle(p, candidate, ops = realOps) {
  // Nothing stops the user's app until the copied bundle passes both gates.
  await ops.verify(p.staged);
  await ops.smoke(p.staged);
  await ops.beforeSwap?.();
  const hadTarget = await exists(p.target);
  if (hadTarget) await ops.verify(p.target);
  const wasRunning = hadTarget && await ops.isRunning(p.target);
  const previousReceipt = await readJson(p.receipt);
  await fs.rm(p.backup, { recursive: true, force: true });
  await atomicJson(p.journal, { candidate, wasRunning, hadTarget, previousReceipt });
  try {
    if (wasRunning) await ops.stop(p.target);
    if (hadTarget) await fs.rename(p.target, p.backup);
    await fs.rename(p.staged, p.target);
    await ops.verify(p.target);
    await ops.smoke(p.target);
    if (wasRunning) await ops.launch(p.target, candidate);
    const receipt = { ...candidate, installedAt: new Date().toISOString(), backup: hadTarget ? p.backup : null };
    await atomicJson(p.receipt, receipt);
    await fs.rm(p.journal);
    return receipt;
  } catch (error) {
    try { await recoverTransaction(p, ops); }
    catch (rollbackError) { throw new Error(`${error.message}\nRollback also needs attention: ${rollbackError.message}`); }
    throw error;
  }
}

export function retryDelay(failures) { return Math.min(3600000, 60000 * 2 ** Math.min(6, Math.max(0, failures - 1))); }
async function rotateLog(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.size > 2_000_000) { await fs.rm(`${file}.previous`, { force: true }); await fs.rename(file, `${file}.previous`); }
}
async function check() {
  const config = await readJson(CONFIG);
  if (!config) throw new Error('Run npm run updater:enable first');
  logFile = path.join(STATE, 'updater.log');
  const releaseLock = await acquireLock(path.join(STATE, 'lock'));
  if (!releaseLock) { console.log('An updater check is already running.'); return; }
  let commit = null;
  const statusFile = path.join(STATE, 'status.json');
  const prior = await readJson(statusFile, {});
  const status = async (phase, more = {}) => atomicJson(statusFile, { ...prior, phase, checkedAt: new Date().toISOString(), ...more });
  const p = paths(config);
  try {
    await rotateLog(logFile);
    await rotateLog(path.join(STATE, 'launchd.log'));
    await prepareTransactionDir(p);
    await recoverTransaction(p);
    const env = { ...process.env, PATH: config.path };
    const git = (args, options = {}) => run(config.git, args, { env, ...options });
    const remoteHead = async () => {
      const { output } = await git(['ls-remote', '--exit-code', config.remote, `refs/heads/${config.branch}`], { timeout: 30000 });
      const sha = output.trim().split(/\s+/)[0];
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Remote main did not return a commit');
      return sha;
    };
    await status('checking');
    commit = await remoteHead();
    const receipt = await readJson(p.receipt);
    const archive = path.join(p.target, 'Contents', 'Resources', 'app.asar');
    if (receipt?.commit === commit && await exists(archive) && await hashFile(archive) === receipt.archiveSha256) {
      await status('up-to-date', { remoteCommit: commit, installedCommit: commit, error: null, failures: 0, retryAt: null });
      return;
    }
    if (prior.failedCommit === commit && Date.now() < Date.parse(prior.retryAt || '')) {
      await status('retry-wait', { remoteCommit: commit });
      return;
    }
    await log(`Building ${config.branch} ${commit}`);
    await status('building', { remoteCommit: commit, error: null });
    const checkout = path.join(STATE, 'checkout');
    if (!(await exists(checkout))) await git(['clone', '--no-checkout', '--single-branch', '--branch', config.branch, config.remote, checkout], { timeout: 180000 });
    const origin = (await git(['remote', 'get-url', 'origin'], { cwd: checkout })).output.trim();
    if (origin !== config.remote) throw new Error('Updater checkout has an unexpected remote');
    await git(['fetch', '--prune', 'origin', `+refs/heads/${config.branch}:refs/remotes/origin/${config.branch}`], { cwd: checkout, timeout: 180000 });
    const fetched = (await git(['rev-parse', `refs/remotes/origin/${config.branch}`], { cwd: checkout })).output.trim();
    if (fetched !== commit) { await status('superseded', { remoteCommit: fetched }); return; }
    await git(['checkout', '--force', '--detach', commit], { cwd: checkout });
    await git(['clean', '-fdx'], { cwd: checkout });
    for (const args of [['ci', '--no-audit', '--no-fund'], ['test'], ['run', 'desktop:pack', '--', `--config.extraMetadata.pulseBuildCommit=${commit}`]]) {
      const result = await run(config.npm, args, { cwd: checkout, env, timeout: 900000 });
      await log(result.output.trim());
    }
    const metadata = await readJson(path.join(checkout, 'package.json'));
    const built = path.join(checkout, 'release', 'mac-arm64', 'Pulse.app');
    await verifyBundle(built);
    if (await remoteHead() !== commit) { await status('superseded', { remoteCommit: commit }); return; }
    await fs.rm(p.staged, { recursive: true, force: true });
    await run('/usr/bin/ditto', [built, p.staged], { timeout: 120000 });
    const candidate = { commit, version: metadata.version, archiveSha256: await hashFile(path.join(p.staged, 'Contents', 'Resources', 'app.asar')) };
    await status('installing', { remoteCommit: commit });
    const installed = await installPreparedBundle(p, candidate, { ...realOps, beforeSwap: async () => {
      if (await remoteHead() !== commit) throw new Error('GitHub main changed during validation; waiting for the next check');
    } });
    await status('updated', { remoteCommit: commit, installedCommit: commit, installedAt: installed.installedAt, error: null, failedCommit: null, failures: 0, retryAt: null });
    await log(`Installed Pulse ${metadata.version} from ${commit}${installed.backup ? `; rollback: ${installed.backup}` : ''}`);
  } catch (error) {
    const failures = prior.failedCommit === commit ? (prior.failures || 0) + 1 : 1;
    await status('failed', { error: error.message, failedCommit: commit, failures, retryAt: new Date(Date.now() + retryDelay(failures)).toISOString() });
    await log(`FAILED: ${error.message}`);
    throw error;
  } finally { await releaseLock(); }
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function launchAgent(config) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(config.node)}</string><string>${xml(path.join(STATE, 'updater.mjs'))}</string><string>check</string></array>
<key>WorkingDirectory</key><string>${xml(STATE)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(config.path)}</string><key>HOME</key><string>${xml(os.homedir())}</string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer><key>ThrottleInterval</key><integer>60</integer>
<key>ProcessType</key><string>Background</string><key>ExitTimeOut</key><integer>90</integer>
<key>StandardOutPath</key><string>${xml(path.join(STATE, 'launchd.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(STATE, 'launchd.log'))}</string>
</dict></plist>\n`;
}
async function executable(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try { await fs.access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new Error(`Cannot find ${name} on PATH`);
}
async function enable() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This updater targets Apple silicon macOS');
  const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  await fs.mkdir(STATE, { recursive: true, mode: 0o700 });
  const git = await executable('git');
  const remote = (await run(git, ['remote', 'get-url', 'origin'], { cwd: repository })).output.trim();
  if (remote !== 'https://github.com/OliverPerrin/pulse.git') throw new Error('Unexpected origin; configure the intended Pulse repository before enabling');
  if (await exists(path.join(STATE, 'lock')) && await readJson(path.join(STATE, 'lock', 'owner.json')).then(owner => owner && alive(owner.pid))) throw new Error('Wait for the active updater check before enabling again');
  const config = { remote, branch: 'main', target: '/Applications/Pulse.app', node: await executable('node'), npm: await executable('npm'), git, path: process.env.PATH, intervalSeconds: 60 };
  await run('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`], { allowFailure: true });
  await fs.copyFile(fileURLToPath(import.meta.url), path.join(STATE, 'updater.mjs'));
  await atomicJson(CONFIG, config);
  await fs.mkdir(path.dirname(PLIST), { recursive: true });
  await fs.writeFile(PLIST, launchAgent(config), { mode: 0o600 });
  await run('/usr/bin/plutil', ['-lint', PLIST]);
  await run('/bin/launchctl', ['enable', `${domain()}/${LABEL}`]);
  await run('/bin/launchctl', ['bootstrap', domain(), PLIST]);
  console.log(`Enabled: checking GitHub main every 60 seconds.\nStatus: npm run updater:status\nLog: ${path.join(STATE, 'updater.log')}`);
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('Local updates require macOS');
  const command = process.argv[2] || 'status';
  if (command === 'enable') return enable();
  if (command === 'check') return check();
  if (command === 'disable') {
    await run('/bin/launchctl', ['disable', `${domain()}/${LABEL}`]);
    await run('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`], { allowFailure: true });
    console.log('Automatic updates disabled. Installed app and rollback copy preserved.');
    return;
  }
  if (command === 'status') {
    const agent = await run('/bin/launchctl', ['print', `${domain()}/${LABEL}`], { allowFailure: true, cwd: os.homedir() });
    const config = await readJson(CONFIG);
    console.log(JSON.stringify({ agentLoaded: agent.code === 0, remote: config?.remote, branch: config?.branch, intervalSeconds: config?.intervalSeconds, status: await readJson(path.join(STATE, 'status.json')), installed: await readJson(path.join(STATE, 'installed.json')) }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    stopping = true;
    if (activeChild && !recovering) { try { process.kill(-activeChild.pid, 'SIGTERM'); } catch {} }
  });
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
