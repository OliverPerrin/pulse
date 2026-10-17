import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const supported = ['codex', 'claude', 'cursor', 'commandcode', 'opencode'];
const configFiles = { codex: ['auth.json', 'config.toml'], claude: ['.credentials.json', 'settings.json', 'projects'], cursor: ['settings.json', 'mcp.json', 'extensions'], commandcode: ['projects'], opencode: ['opencode.json', 'opencode.jsonc'] };
const defaults = { codex: '.codex', claude: '.claude', cursor: '.cursor', commandcode: '.commandcode', opencode: '.config/opencode' };

export function expandPath(value, home = homedir()) {
  return String(value || '').replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home);
}

export function validateProvider(input, home = homedir()) {
  if (!supported.includes(input?.provider)) throw new Error('Choose a supported provider.');
  const name = String(input.name || '').trim();
  const directory = expandPath(input.home || path.join(home, defaults[input.provider]), home);
  const command = expandPath(input.command || input.provider, home);
  if (!name || name.length > 64 || /[\x00-\x1f]/.test(name)) throw new Error('Enter a name of 1–64 characters.');
  if (!path.isAbsolute(directory) || /[\x00-\x1f]/.test(directory)) throw new Error('Use an absolute configuration folder or a path starting with ~/.');
  if (!command || command.length > 1024 || /[\x00-\x1f]/.test(command) || (!path.isAbsolute(command) && !/^[a-zA-Z0-9._-]+$/.test(command))) throw new Error('Use an executable name or absolute path, without command arguments.');
  return { provider: input.provider, name, home: path.normalize(directory), command };
}

export function createProviderRegistry({ home = homedir(), env = process.env, configPath = path.join(home, '.config/pulse/providers.json') } = {}) {
  let state = null, loading = null, scan = null, scanAt = 0, signature = null, writing = Promise.resolve();
  const exists = async p => Boolean(await fs.stat(p).catch(() => null));
  async function json(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
  async function load() {
    if (loading) { await loading; return state; }
    const stat = await fs.stat(configPath).catch(() => null);
    const currentSignature = stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : 'missing';
    if (state && signature === currentSignature) return state;
    loading = json(configPath).then(value => {
      state = { version: 1, setupComplete: value?.setupComplete === true, custom: Array.isArray(value?.custom) ? value.custom : [], disabled: Array.isArray(value?.disabled) ? value.disabled : [] };
      signature = currentSignature; scan = null;
    });
    try { await loading; } finally { loading = null; }
    return state;
  }
  function identity(provider, directory) {
    // Preserve existing cache identities for the old default homes.
    const old = { '.codex': 'codex-main', '.codex_alt': 'codex-alt', '.codex_alt2': 'codex-alt2' };
    return provider === 'codex' && path.dirname(directory) === home && old[path.basename(directory)]
      || `${provider}-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`;
  }
  async function discover(force = false) {
    await load();
    if (scan && (!force || Date.now() - scanAt < 1000)) return scan;
    scanAt = Date.now();
    scan = (async () => {
      const found = new Map();
      async function add(provider, directory, source, name, command, explicit = false) {
        directory = path.normalize(expandPath(directory, home));
        if (!path.isAbsolute(directory)) return;
        if (!explicit && !(await Promise.all(configFiles[provider].map(file => exists(path.join(directory, file))))).some(Boolean)) return;
        const id = identity(provider, directory);
        const previous = found.get(id);
        found.set(id, { id, provider, home: directory, name: name || path.basename(directory), profile: name || path.basename(directory).replace(/^\.codex_/, '.codex-'), command: command || env[`${provider.toUpperCase()}_BIN`] || provider, source: previous?.source === 'Added by you' ? previous.source : source, enabled: !state.disabled.includes(id) });
      }
      await Promise.all(supported.map(provider => add(provider, path.join(home, defaults[provider]), 'Local configuration', provider === 'claude' ? 'Claude Code' : undefined)));
      const entries = await fs.readdir(home, { withFileTypes: true }).catch(() => []);
      await Promise.all(entries.filter(entry => entry.isDirectory() && /^\.(codex|claude)[_-][\w.-]+$/.test(entry.name)).map(entry => add(entry.name.startsWith('.codex') ? 'codex' : 'claude', path.join(home, entry.name), 'Local configuration')));
      for (const [provider, key] of [['codex', 'CODEX_HOME'], ['claude', 'CLAUDE_CONFIG_DIR']]) if (env[key]) await add(provider, env[key], 'Terminal environment');
      // Read assignments only. Shell files are never sourced or executed.
      for (const file of ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']) {
        const stat = await fs.stat(path.join(home, file)).catch(() => null);
        if (!stat?.isFile() || stat.size > 256 * 1024) continue;
        const content = await fs.readFile(path.join(home, file), 'utf8').catch(() => '');
        const assignments = /(?:^|[\s;'"])(?:export\s+)?(CODEX_HOME|CLAUDE_CONFIG_DIR)\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;"']+))/gm;
        for (const match of content.matchAll(assignments)) {
          const directory = match[2] || match[3] || match[4];
          if (/[`()]|\$\(/.test(directory)) continue;
          await add(match[1] === 'CODEX_HOME' ? 'codex' : 'claude', directory, 'Terminal configuration');
        }
      }
      const t3 = await json(path.join(home, '.t3/userdata/settings.json'));
      for (const instance of Object.values(t3?.providerInstances || {})) {
        const provider = instance?.driver;
        if (!supported.includes(provider) || instance.enabled === false) continue;
        const directory = instance.config?.shadowHomePath || instance.config?.homePath || path.join(home, defaults[provider]);
        await add(provider, directory, 'T3 Code', instance.displayName, instance.config?.binaryPath);
      }
      for (const provider of supported) {
        const executable = env[`${provider.toUpperCase()}_BIN`] || provider;
        const candidates = path.isAbsolute(executable) ? [executable] : String(env.PATH || '').split(path.delimiter).filter(Boolean).map(folder => path.join(folder, executable));
        for (const candidate of candidates) {
          const stat = await fs.stat(candidate).catch(() => null);
          if (stat?.isFile() && (stat.mode & 0o111)) {
            const directory = path.join(home, defaults[provider]);
            if (!found.has(identity(provider, directory))) await add(provider, directory, 'Installed CLI', provider === 'claude' ? 'Claude Code' : provider, executable, true);
            break;
          }
        }
      }
      for (const custom of state.custom) {
        try { const value = validateProvider(custom, home); await add(value.provider, value.home, 'Added by you', value.name, value.command, true); } catch { /* Ignore invalid saved entries. */ }
      }
      const providers = (await Promise.all([...found.values()].map(async item => ({ ...item, configExists: await exists(item.home) })))).sort((a, b) => supported.indexOf(a.provider) - supported.indexOf(b.provider) || a.home.localeCompare(b.home));
      return { setupComplete: state.setupComplete, providers, scannedAt: Date.now() };
    })();
    try { return await scan; } catch (error) { scan = null; throw error; }
  }
  async function update(action) {
    const operation = writing.then(async () => {
      await load();
      const next = structuredClone(state);
      if (action.type === 'add') {
        const entry = validateProvider(action, home);
        next.custom = next.custom.filter(item => item.provider !== entry.provider || expandPath(item.home, home) !== entry.home);
        next.custom.push(entry);
        next.disabled = next.disabled.filter(id => id !== identity(entry.provider, entry.home));
      } else if (action.type === 'toggle') {
        const discovered = await discover();
        if (!discovered.providers.some(item => item.id === action.id)) throw new Error('Provider configuration was not found. Scan again.');
        next.disabled = next.disabled.filter(id => id !== action.id);
        if (action.enabled === false) next.disabled.push(action.id);
      } else if (action.type === 'complete') next.setupComplete = true;
      else throw new Error('Unknown provider action.');
      await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
      const temporary = `${configPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      await fs.rename(temporary, configPath);
      state = next; scan = null;
      return discover();
    });
    writing = operation.catch(() => {});
    return operation;
  }
  return { discover, update };
}
