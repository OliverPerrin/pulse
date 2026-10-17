import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProviderRegistry, validateProvider } from '../provider-registry.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'pulse-provider-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  async function write(relative, content = '{}') {
    const target = path.join(home, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    return target;
  }
  return { home, write, env: { PATH: '' } };
}

test('first launch discovers standard, alternate, terminal, and T3 profiles without exposing auth contents', async t => {
  const f = await fixture(t);
  await f.write('.codex/auth.json', '{"token":"never-expose-this"}');
  await f.write('.codex_alt/auth.json');
  await f.write('work-profile/config.toml', '');
  await f.write('claude-work/settings.json');
  await f.write('.zshrc', `alias work='CODEX_HOME="$HOME/work-profile" codex'\nexport CLAUDE_CONFIG_DIR="$HOME/claude-work"\nexport CODEX_HOME="$(touch $HOME/should-not-exist)"`);
  await f.write('.t3/userdata/settings.json', JSON.stringify({ providerInstances: { work: { driver: 'codex', displayName: 'T3 work', config: { shadowHomePath: path.join(f.home, '.codex_alt'), secret: 'never-expose-this' } } } }));
  const registry = createProviderRegistry(f);
  const result = await registry.discover();
  assert.equal(result.setupComplete, false);
  assert.equal(result.providers.length, 4);
  assert.equal(result.providers.find(p => p.id === 'codex-alt').name, 'T3 work');
  assert.equal(result.providers.find(p => p.home.endsWith('/work-profile')).source, 'Terminal configuration');
  assert.equal(result.providers.find(p => p.home.endsWith('/claude-work')).provider, 'claude');
  assert.ok(!JSON.stringify(result).includes('never-expose-this'));
  assert.equal(await fs.stat(path.join(f.home, 'should-not-exist')).catch(() => null), null);
});

test('manual profiles, enabled state, and completed setup persist across browser and desktop server restarts', async t => {
  const f = await fixture(t);
  const first = createProviderRegistry(f);
  const added = await first.update({ type: 'add', provider: 'claude', name: 'Private work', home: '~/work-claude', command: '/opt/tools/claude' });
  const profile = added.providers[0];
  assert.equal(profile.configExists, false);
  assert.equal(profile.command, '/opt/tools/claude');
  await first.update({ type: 'toggle', id: profile.id, enabled: false });
  await first.update({ type: 'complete' });
  const second = await createProviderRegistry(f).discover();
  assert.equal(second.setupComplete, true);
  assert.equal(second.providers[0].enabled, false);
  assert.equal(second.providers[0].home, path.join(f.home, 'work-claude'));
  const stat = await fs.stat(path.join(f.home, '.config/pulse/providers.json'));
  assert.equal(stat.mode & 0o777, 0o600);
});

test('custom overrides are deduplicated by provider and normalized home; concurrent saves are serialized', async t => {
  const f = await fixture(t);
  await f.write('.codex/config.toml', '');
  const registry = createProviderRegistry(f);
  await Promise.all([
    registry.update({ type: 'add', provider: 'codex', name: 'Renamed', home: '~/.codex' }),
    registry.update({ type: 'add', provider: 'claude', name: 'Claude work', home: '~/work' })
  ]);
  const result = await registry.discover();
  assert.equal(result.providers.length, 2);
  assert.equal(result.providers.find(item => item.provider === 'codex').name, 'Renamed');
  assert.equal(result.providers.find(item => item.provider === 'codex').id, 'codex-main');
});

test('installed executables are discoverable without an existing sign-in or config folder', async t => {
  const f = await fixture(t);
  const executable = await f.write('bin/codex', '#!/bin/sh\nexit 0');
  await fs.chmod(executable, 0o700);
  const result = await createProviderRegistry({ ...f, env: { PATH: path.dirname(executable) } }).discover();
  assert.equal(result.providers[0].source, 'Installed CLI');
  assert.equal(result.providers[0].configExists, false);
});

test('running localhost and desktop registries observe each other without a restart', async t => {
  const f = await fixture(t);
  const browser = createProviderRegistry(f), desktop = createProviderRegistry(f);
  assert.equal((await browser.discover()).providers.length, 0);
  assert.equal((await desktop.discover()).providers.length, 0);
  const added = await browser.update({ type: 'add', provider: 'codex', name: 'Work', home: '~/work' });
  assert.equal((await desktop.discover()).providers[0].name, 'Work');
  await desktop.update({ type: 'toggle', id: added.providers[0].id, enabled: false });
  assert.equal((await browser.discover()).providers[0].enabled, false);
  await browser.update({ type: 'complete' });
  assert.equal((await desktop.discover()).setupComplete, true);
});

test('manual settings reject invalid providers, relative paths, and executable arguments', () => {
  for (const input of [
    { provider: 'unknown', name: 'test', home: '/tmp/test' },
    { provider: 'codex', name: 'test', home: 'relative' },
    { provider: 'codex', name: 'test', home: '/tmp/test', command: 'codex --exec' },
    { provider: 'claude', name: 'test', home: '/tmp/test', command: 'claude;touch' }
  ]) assert.throws(() => validateProvider(input));
  assert.equal(validateProvider({ provider: 'codex', name: 'Work', home: '$HOME/work' }, '/tmp/user').home, '/tmp/user/work');
});
