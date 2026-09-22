import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const installer = path.join(repoRoot, 'scripts', 'install-opencode-model-routing.mjs');
const profiles = [
  ['expert', 'superpowers-expert.md'],
  ['main', 'superpowers-main.md'],
  ['economic', 'superpowers-economic.md'],
];
const selectedModels = {
  expert: 'anthropic/claude-opus',
  main: 'openai/gpt-main',
  economic: 'google/gemini-flash',
};
const { V1_MAPPING, V2_MAPPING } = await import(pathToFileURL(path.join(repoRoot, '.opencode/plugins/superpowers.js')).href);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'superpowers-model-routing-'));
try {
  function writeModelsFile(name, value) {
    const target = path.join(tempRoot, name);
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    return target;
  }

  function install(configDir, modelsFile, extraArgs = []) {
    return runInstaller('--config-dir', configDir, '--models-file', modelsFile, ...extraArgs);
  }

  const validModelsFile = writeModelsFile('valid-models.json', selectedModels);
  for (const [name, args] of [
    ['missing-models-file', ['--config-dir', path.join(tempRoot, 'missing-models-file')]],
    ['missing-config-dir', ['--models-file', validModelsFile]],
    ['duplicate-models-file', ['--config-dir', path.join(tempRoot, 'duplicate-models-file'), '--models-file', validModelsFile, '--models-file', validModelsFile]],
    ['option-like-models-file', ['--config-dir', path.join(tempRoot, 'option-like-models-file'), '--models-file', '--config-dir']],
    ['positional-models-file', ['--config-dir', path.join(tempRoot, 'positional-models-file'), validModelsFile]],
  ]) {
    const invalid = runInstaller(...args);
    assert.notEqual(invalid.status, 0, `installer must reject ${name}`);
    assert.match(invalid.stderr, /Usage:.*--config-dir.*--models-file/, `${name} must print usage`);
    assertNoAgents(path.join(tempRoot, name));
  }

  for (const [name, contents] of [
    ['malformed.json', '{'],
    ['array.json', []],
    ['missing-role.json', { expert: 'a/b', main: 'c/d' }],
    ['unknown-role.json', { expert: 'a/b', main: 'c/d', economic: 'e/f', spare: 'g/h' }],
    ['non-string.json', { expert: 1, main: 'c/d', economic: 'e/f' }],
    ['blank.json', { expert: '   ', main: 'c/d', economic: 'e/f' }],
    ['no-slash.json', { expert: 'ab', main: 'c/d', economic: 'e/f' }],
    ['empty-side.json', { expert: 'a/', main: 'c/d', economic: 'e/f' }],
    ['empty-provider.json', { expert: '/b', main: 'c/d', economic: 'e/f' }],
    ['newline.json', { expert: 'a/b\nmodel: injected', main: 'c/d', economic: 'e/f' }],
    ['carriage-return.json', { expert: 'a/b\rmode: primary', main: 'c/d', economic: 'e/f' }],
  ]) {
    const invalidConfig = path.join(tempRoot, `invalid-${name}`);
    const invalid = install(invalidConfig, writeModelsFile(name, contents));
    assert.notEqual(invalid.status, 0, `installer must reject ${name}`);
    assertNoAgents(invalidConfig);
  }

  for (const role of [
    'superpowers-expert',
    'superpowers-main',
    'superpowers-economic',
    'architecture',
    'implementation',
    'exploration',
    'general',
  ]) {
    assert.match(V2_MAPPING, new RegExp(escapeRegExp(role)), `V2 routing must include ${role}`);
  }
  assert.match(V2_MAPPING, /only when it is available in the subagent catalog/, 'V2 routing must require catalog availability');
  assert.match(V2_MAPPING, /If the needed role is unavailable, invoke `subagent` with `agent: "general"`/, 'V2 routing must use the general agent when a role is missing');
  assert.match(V2_MAPPING, /state that model-role routing is not installed/, 'V2 routing must disclose missing installation');
  assert.match(V1_MAPPING, /`task` with `subagent_type: "general"`/, 'V1 routing must retain the general task mapping');
  assert.doesNotMatch(V1_MAPPING, /superpowers-expert/, 'V1 routing must not include V2 model profiles');

  assertModelRoutingGuides();

  const nestedModels = { ...selectedModels, expert: 'openrouter/anthropic/claude-sonnet-4' };
  const nestedConfigDir = path.join(tempRoot, 'nested-model-config');
  const nested = install(nestedConfigDir, writeModelsFile('nested-models.json', nestedModels));
  assert.equal(nested.status, 0, `nested model identifiers must install: ${nested.stderr}`);
  assertInstalledProfile(nestedConfigDir, 'superpowers-expert.md', nestedModels.expert);

  for (const [index, model] of [
    'provider/model$&',
    'provider/model$`',
    "provider/model$'",
    'provider/model # suffix',
    'provider/model" : injected',
    'provider/model\\with\\escapes\tand-tab',
  ].entries()) {
    const literalConfig = path.join(tempRoot, `literal-model-config-${index}`);
    const literalModels = Object.fromEntries(profiles.map(([role]) => [role, model]));
    const literal = install(literalConfig, writeModelsFile(`literal-models-${index}.json`, literalModels));
    assert.equal(literal.status, 0, `literal model must install: ${literal.stderr}`);
    for (const [, name] of profiles) assertInstalledProfile(literalConfig, name, model);
  }

  const configDir = path.join(tempRoot, 'success-config');
  const success = install(configDir, validModelsFile);
  assert.equal(success.status, 0, `expected successful install: ${success.stderr}`);

  for (const [role, name] of profiles) {
    assertInstalledProfile(configDir, name, selectedModels[role]);
  }

  const reversedConfigDir = path.join(tempRoot, 'reversed-config');
  const reversed = runInstaller('--models-file', validModelsFile, '--config-dir', reversedConfigDir);
  assert.equal(reversed.status, 0, `expected reversed arguments to install: ${reversed.stderr}`);

  const collisionConfig = path.join(tempRoot, 'collision-config');
  const collisionTarget = path.join(collisionConfig, 'agents', 'superpowers-expert.md');
  fs.mkdirSync(path.dirname(collisionTarget), { recursive: true });
  fs.writeFileSync(collisionTarget, 'user-owned\n');
  const collision = install(collisionConfig, validModelsFile);
  assert.notEqual(collision.status, 0, 'installer must fail when a profile destination already exists');
  assert.equal(fs.readFileSync(collisionTarget, 'utf8'), 'user-owned\n', 'collision must preserve user-owned profile');
  for (const [, name] of profiles.slice(1)) {
    assert.ok(!fs.existsSync(path.join(collisionConfig, 'agents', name)), `collision preflight must not copy ${name}`);
  }

  const danglingLinkConfig = path.join(tempRoot, 'dangling-link-config');
  const danglingLinkTarget = path.join(danglingLinkConfig, 'agents', 'superpowers-expert.md');
  fs.mkdirSync(path.dirname(danglingLinkTarget), { recursive: true });
  let danglingLinkSupported = true;
  try {
    fs.symlinkSync('missing-user-profile.md', danglingLinkTarget, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    danglingLinkSupported = false;
  }
  if (danglingLinkSupported) {
    const danglingLink = install(danglingLinkConfig, validModelsFile);
    assert.notEqual(danglingLink.status, 0, 'installer must reject a dangling destination symlink');
    assert.ok(fs.lstatSync(danglingLinkTarget).isSymbolicLink(), 'installer must preserve the dangling user-owned symlink');
    for (const [, name] of profiles.slice(1)) {
      assert.ok(!fs.existsSync(path.join(danglingLinkConfig, 'agents', name)), `dangling-link preflight must not copy ${name}`);
    }
  }

  for (const [collisionIndex, [, collisionName]] of profiles.slice(0, 2).entries()) {
    const writeCollisionConfig = path.join(tempRoot, `write-collision-config-${collisionIndex}`);
    const writeCollisionTarget = path.join(writeCollisionConfig, 'agents', collisionName);
    const hookPath = path.join(tempRoot, `inject-write-collision-${collisionIndex}.cjs`);
    fs.writeFileSync(hookPath, `
const fs = require('node:fs');
const path = require('node:path');
const originalWriteFileSync = fs.writeFileSync;
let injected = false;
fs.writeFileSync = function(destination, content, options) {
  if (!injected && path.basename(destination) === ${JSON.stringify(collisionName)} && options && options.flag === 'wx') {
    originalWriteFileSync(destination, 'user-owned-at-write\\n');
    injected = true;
  }
  return originalWriteFileSync.call(this, destination, content, options);
};
`);
    const writeCollision = install(writeCollisionConfig, validModelsFile, [{
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${hookPath}`.trim(),
    }]);
    assert.notEqual(writeCollision.status, 0, 'installer must fail when a destination appears during write');
    assert.equal(fs.readFileSync(writeCollisionTarget, 'utf8'), 'user-owned-at-write\n', 'exclusive write must not overwrite a destination created during write');
    for (const [role, name] of profiles.slice(0, collisionIndex)) {
      assertInstalledProfile(writeCollisionConfig, name, selectedModels[role]);
      assert.ok(writeCollision.stdout.includes(path.join(writeCollisionConfig, 'agents', name)), 'installer must report the generated profile retained before a later collision');
    }
    for (const [, name] of profiles.slice(collisionIndex + 1)) {
      assert.ok(!fs.existsSync(path.join(writeCollisionConfig, 'agents', name)), `write collision must not write later profile ${name}`);
    }
  }

  console.log('PASS: OpenCode model routing validates JSON-driven profiles without overwriting user files');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function assertNoAgents(configDir) {
  assert.ok(!fs.existsSync(configDir), `invalid input must not create config directory ${configDir}`);
  assert.ok(!fs.existsSync(path.join(configDir, 'agents')), `invalid input must not create agents directory ${configDir}`);
}

function assertInstalledProfile(configDir, name, expectedModel) {
  const content = fs.readFileSync(path.join(configDir, 'agents', name), 'utf8');
  const modelLines = [...content.matchAll(/^model: (.*)$/gm)];
  assert.equal(modelLines.length, 1, `${name} must contain exactly one model field`);
  // JSON strings are a YAML double-quoted scalar subset. Decode the emitted
  // scalar instead of comparing its spelling or adding a YAML dependency.
  assert.equal(JSON.parse(modelLines[0][1]), expectedModel, `${name} must preserve the exact model value`);
  const template = fs.readFileSync(path.join(repoRoot, 'opencode', 'model-routing', 'agents', name), 'utf8');
  assert.equal(
    content.replace(/^model: .*$/m, 'model: {{MODEL}}'),
    template,
    `${name} must preserve the surrounding frontmatter and prompt without injection`,
  );
}

function assertModelRoutingGuides() {
  for (const guide of ['.opencode/INSTALL.md', 'docs/README.opencode.md']) {
    const content = fs.readFileSync(path.join(repoRoot, guide), 'utf8');
    for (const expected of [
      '--models-file',
      '"expert"',
      '"main"',
      '"economic"',
      'provider/model',
      'opencode models',
      'superpowers-expert',
      'superpowers-main',
      'superpowers-economic',
      'agents/superpowers-expert.md',
      'agents/superpowers-main.md',
      'agents/superpowers-economic.md',
    ]) {
      assert.match(content, new RegExp(escapeRegExp(expected)), `${guide} must document ${expected}`);
    }
    assert.match(content, /does\s+not modify `opencode\.json` or `opencode\.jsonc`/, `${guide} must say the installer does not mutate OpenCode configuration`);
    assert.match(content, /falls back to\s+`general`/, `${guide} must document the general fallback`);
    assert.match(content, /refuses to overwrite an\s+existing profile if it finds a collision/, `${guide} must document collision refusal`);
    assert.match(content, /edit `superpowers-models\.json`, deliberately remove or\s+rename all three generated profiles, then rerun the installer/, `${guide} must require removing or renaming all generated profiles before an update`);
    for (const forbidden of ['zai-org/GLM-5.3', 'z-ai/glm-5.3-flash', 'xiaomi/mimo-v2.5']) {
      assert.doesNotMatch(content, new RegExp(escapeRegExp(forbidden)), `${guide} must not prescribe ${forbidden}`);
    }
    assert.match(content, /```powershell\s+node \.\\scripts\\install-opencode-model-routing\.mjs --config-dir "\$HOME\\\.config\\opencode" --models-file \.\\superpowers-models\.json\s+opencode models\s+```/m, `${guide} must include the PowerShell command with both required flags`);
    assert.match(content, /```bash\s+node \.\/scripts\/install-opencode-model-routing\.mjs --config-dir "\$HOME\/\.config\/opencode" --models-file \.\/superpowers-models\.json\s+opencode models\s+```/m, `${guide} must include the POSIX command with both required flags`);
    assert.match(content, /opencode run --model <the-main-value-from-superpowers-models\.json> \.\.\./, `${guide} must explain how MAIN uses the main models-file value`);
  }
}

function runInstaller(...args) {
  let extraEnv = {};
  if (args.length > 0 && typeof args.at(-1) === 'object') extraEnv = args.pop();
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
