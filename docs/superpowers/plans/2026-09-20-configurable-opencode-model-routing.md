# Configurable OpenCode Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the three OpenCode routing profiles from a user-owned JSON model mapping instead of shipping fixed provider/model identifiers.

**Architecture:** The bundled Markdown agents become provider-neutral templates containing one `{{MODEL}}` token. The dependency-free installer requires an explicit configuration directory and JSON file, validates both before creating generated profiles, then renders each template with the selected role model. The V2 bootstrap remains role-only and V1 stays unchanged.

**Tech Stack:** Node.js ESM with built-in `assert`, `fs`, `path`, `child_process`, and `url`; Markdown/YAML frontmatter; Bash test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-configurable-opencode-model-routing-design.md`

## Global Constraints

- Require OpenCode V2 2.0.4 or later and preserve V1 behavior plus V2 tool mappings.
- Keep exactly `superpowers-expert`, `superpowers-main`, and `superpowers-economic`.
- Do not embed a provider/model ID in source profiles, bootstrap mappings, or guides.
- Add no dependencies, providers, credentials, catalogs, or automatic edits to `opencode.json` or `opencode.jsonc`.
- Require one `--config-dir <path>` and one `--models-file <path>` flag in either order; reject duplicate, missing, empty, option-like, and positional values before filesystem mutation.
- Require exactly JSON keys `expert`, `main`, and `economic`; each has a nonempty provider before the first `/` and a nonempty remainder after it, allowing nested model identifiers but rejecting carriage returns and line feeds.
- Preserve no-overwrite behavior: preflight all destinations, treat dangling symlinks as collisions, and exclusively create targets.
- Describe the writes as sequential and non-transactional: a collision introduced after preflight can leave earlier generated profiles in place while preserving the colliding file and skipping later writes.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `opencode/model-routing/agents/superpowers-expert.md` | EXPERT template with one `{{MODEL}}` token. |
| `opencode/model-routing/agents/superpowers-main.md` | MAIN template with one `{{MODEL}}` token. |
| `opencode/model-routing/agents/superpowers-economic.md` | ECONOMIC template with one `{{MODEL}}` token. |
| `scripts/install-opencode-model-routing.mjs` | Parses flags, validates JSON, renders templates, installs safely. |
| `tests/opencode/test-model-routing.mjs` | Contract test for arguments, JSON, rendering, safety, mappings, docs. |
| `.opencode/INSTALL.md` | Setup, schema, role guidance, update, and removal instructions. |
| `docs/README.opencode.md` | Public guide matching the installation instructions. |

### Task 1: Generate profiles from a validated models file

**Files:**
- Modify: `opencode/model-routing/agents/superpowers-expert.md:1-6`
- Modify: `opencode/model-routing/agents/superpowers-main.md:1-6`
- Modify: `opencode/model-routing/agents/superpowers-economic.md:1-6`
- Modify: `scripts/install-opencode-model-routing.mjs:1-61`
- Modify: `tests/opencode/test-model-routing.mjs:1-184`

**Interfaces:**
- Consumes: `--config-dir <path>`, `--models-file <path>`, JSON `{ expert, main, economic }`.
- Produces: three generated profiles under `<config-dir>/agents/` with exact selected `model:` values.

- [ ] **Step 1: Write the failing JSON-driven test contract**

Replace fixed model pairs in `tests/opencode/test-model-routing.mjs` with:

```js
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

function writeModelsFile(name, value) {
  const target = path.join(tempRoot, name);
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  return target;
}

function install(configDir, modelsFile, extraArgs = []) {
  return runInstaller('--config-dir', configDir, '--models-file', modelsFile, ...extraArgs);
}
```

Add invalid CLI cases for missing, duplicate, option-like, and positional `--models-file` arguments. Assert every case fails before creating config or agents. Add these invalid JSON cases and assert each leaves no generated agents:

```js
[
  ['malformed.json', '{'],
  ['array.json', []],
  ['missing-role.json', { expert: 'a/b', main: 'c/d' }],
  ['unknown-role.json', { expert: 'a/b', main: 'c/d', economic: 'e/f', spare: 'g/h' }],
  ['non-string.json', { expert: 1, main: 'c/d', economic: 'e/f' }],
  ['blank.json', { expert: '   ', main: 'c/d', economic: 'e/f' }],
  ['no-slash.json', { expert: 'ab', main: 'c/d', economic: 'e/f' }],
  ['empty-side.json', { expert: 'a/', main: 'c/d', economic: 'e/f' }],
  ['newline.json', { expert: 'a/b\\nmodel: injected', main: 'c/d', economic: 'e/f' }],
]
```

Use a valid models file for success, collision, dangling-symlink, and write-race cases. Parse each emitted JSON-compatible quoted YAML `model:` scalar and assert its value equals the chosen string exactly. Include nested model identifiers, `$&`, dollar-backtick, and `# suffix` cases; verify the surrounding frontmatter and prompt body remain unchanged. Inject a race at both the first and second writes; assert user-owned collisions survive, earlier generated profiles remain intact, and subsequent profiles are absent.

- [ ] **Step 2: Prove the changed test fails**

Run: `node tests/opencode/test-model-routing.mjs`.

Expected: FAIL because the current installer accepts only `--config-dir`, source profiles contain fixed models, and it cannot read/render the JSON.

- [ ] **Step 3: Make source profiles provider-neutral templates**

Replace only the fixed frontmatter values in all three source profiles with:

```markdown
model: {{MODEL}}
```

Keep role descriptions and body text unchanged. Do not add model IDs in comments, descriptions, or examples.

- [ ] **Step 4: Parse arguments and JSON before mutation**

Define shared metadata and strict parsers in the installer:

```js
const profiles = [
  { key: 'expert', name: 'superpowers-expert.md' },
  { key: 'main', name: 'superpowers-main.md' },
  { key: 'economic', name: 'superpowers-economic.md' },
];

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--config-dir', '--models-file'].includes(flag) || values.has(flag) || !value || value.startsWith('-')) throw new Error(usage());
    values.set(flag, value);
  }
  if (args.length !== 4 || values.size !== 2) throw new Error(usage());
  return { configDir: path.resolve(values.get('--config-dir')), modelsFile: path.resolve(values.get('--models-file')) };
}

function readModelsFile(modelsFile) {
  let models;
  try { models = JSON.parse(fs.readFileSync(modelsFile, 'utf8')); }
  catch (error) { throw new Error(`Invalid models file ${modelsFile}: ${error.message}`); }
  if (!models || Array.isArray(models) || typeof models !== 'object') throw new Error('Models file must contain a JSON object');
  const expected = new Set(profiles.map(({ key }) => key));
  const keys = Object.keys(models);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) throw new Error('Models file must contain exactly: expert, main, economic');
  for (const key of expected) {
    if (typeof models[key] !== 'string' || !/^[^\r\n/]+\/[^\r\n]+$/.test(models[key])) throw new Error(`Invalid model for ${key}: expected provider/model`);
  }
  return models;
}
```

Make `usage()` return `Usage: node scripts/install-opencode-model-routing.mjs --config-dir <path> --models-file <path>`. Call both functions before the first `mkdirSync`.

- [ ] **Step 5: Render all templates before collision preflight**

Use this renderer and assemble render results before calling `mkdirSync` or writing:

```js
function renderProfile(source, model) {
  const token = '{{MODEL}}';
  const occurrences = source.split(token).length - 1;
  if (occurrences !== 1) throw new Error('Expected exactly one {{MODEL}} token in profile template');
  return source.replace(token, () => JSON.stringify(model));
}

const copies = profiles.map(({ key, name }) => {
  const source = path.join(sourceDir, name);
  ensureFile(source);
  return { destination: path.join(agentsDir, name), content: renderProfile(fs.readFileSync(source, 'utf8'), models[key]) };
});
```

Retain `lstatSync` collision detection and all-destination preflight. Write each rendered target with `fs.writeFileSync(destination, content, { flag: 'wx' })`, preserving exclusive-create race protection. Do not add rollback: a concurrent collision on a later destination leaves the already generated profiles in place and the colliding user-owned file untouched.

- [ ] **Step 6: Prove the focused test passes**

Run: `node tests/opencode/test-model-routing.mjs`.

Expected: PASS for exact propagation, no-write invalid cases, and collision safety.

- [ ] **Step 7: Commit Task 1**

Run: `git add opencode/model-routing/agents scripts/install-opencode-model-routing.mjs tests/opencode/test-model-routing.mjs && git commit -m "feat(opencode): configure routing models from JSON"`.

### Task 2: Document user-selected models without recommendations

**Files:**
- Modify: `.opencode/INSTALL.md:46-105`
- Modify: `docs/README.opencode.md:46-105`
- Modify: `tests/opencode/test-model-routing.mjs:40-107`

**Interfaces:**
- Consumes: `--models-file` and exactly JSON keys `expert`, `main`, `economic`.
- Produces: copy-pasteable setup guidance without a prescribed provider or model.

- [ ] **Step 1: Add failing guide assertions**

For both guides require `--models-file`, `"expert"`, `"main"`, `"economic"`, `provider/model`, `opencode models`, and all three profile IDs. Assert neither guide has `zai-org/GLM-5.3`, `z-ai/glm-5.3-flash`, or `xiaomi/mimo-v2.5`. Require PowerShell and POSIX examples to include both flags, and MAIN guidance to say `--model` uses the `main` value from the models file. Retain assertions for no `opencode.json` mutation, `general` fallback, collision warning, and exact removal targets.

- [ ] **Step 2: Prove guide assertions fail**

Run: `node tests/opencode/test-model-routing.mjs`.

Expected: FAIL only at documentation checks because guides still list fixed models and omit the models file interface.

- [ ] **Step 3: Rewrite both Model routing sections**

State users choose providers/models and no credentials are managed. Include this local user-owned schema:

```json
{
  "expert": "provider/model",
  "main": "provider/model",
  "economic": "provider/model"
}
```

Add these exact commands:

```powershell
node .\scripts\install-opencode-model-routing.mjs --config-dir "$HOME\.config\opencode" --models-file .\superpowers-models.json
opencode models
```

```bash
node ./scripts/install-opencode-model-routing.mjs --config-dir "$HOME/.config/opencode" --models-file ./superpowers-models.json
opencode models
```

Describe role purposes, fallback to `general`, and collision refusal. State a primary MAIN session uses `opencode run --model <the-main-value-from-superpowers-models.json> ...`; switching an existing agent does not change its selected model. For updates, say to edit JSON, deliberately remove or rename all three generated profiles, and rerun the installer. The installer checks the entire three-profile set before writing, so any destination found at preflight prevents all profile writes. Explain that writes are sequential, not transactional: a later destination created concurrently after preflight can leave earlier generated profiles in place; the collision is preserved and later profiles are not written. Tell users to inspect the resulting files before retrying. List exact three removal targets with no glob.

- [ ] **Step 4: Prove docs and full suite pass**

Run: `node tests/opencode/test-model-routing.mjs && bash tests/opencode/run-tests.sh`.

Expected: focused contract PASS and all five non-integration OpenCode tests PASS.

- [ ] **Step 5: Commit Task 2**

Run: `git add .opencode/INSTALL.md docs/README.opencode.md tests/opencode/test-model-routing.mjs && git commit -m "docs(opencode): explain configurable model routing"`.

### Task 3: Final verification and delivery readiness

**Files:**
- Verify: Task 1 and Task 2 files plus `docs/superpowers/specs/2026-09-20-configurable-opencode-model-routing-design.md`.

**Interfaces:**
- Consumes: JSON configuration and provider-neutral templates.
- Produces: evidence that no fixed routing model remains and static checks pass.

- [ ] **Step 1: Verify scope and whitespace**

Run: `git status --short && git diff --check origin/main...HEAD`.

Expected: only planned routing assets and design/plan documents change; no whitespace diagnostics.

- [ ] **Step 2: Verify no stale models remain**

Run: `rg -n 'zai-org/GLM-5\.3|z-ai/glm-5\.3-flash|xiaomi/mimo-v2\.5|deepseek/deepseek-v4-flash|economic-fast' .opencode/INSTALL.md .opencode/plugins/superpowers.js docs/README.opencode.md opencode/model-routing scripts/install-opencode-model-routing.mjs`.

Expected: no matches. Revise or remove any retained document that communicates an unsupported fixed default.

- [ ] **Step 3: Repeat the suite with native symlink semantics**

Run: `& 'C:\Program Files\Git\bin\bash.exe' -lc 'export MSYS=winsymlinks:nativestrict; bash tests/opencode/run-tests.sh'` from PowerShell.

Expected: all five non-integration tests PASS. This Windows/Git Bash checkout needs the environment variable for native dangling-symlink fixture semantics.

- [ ] **Step 4: Record runtime evidence accurately**

Run: `npm exec --yes --package @opencode/cli@latest opencode --version`.

Expected: a CLI version. Do not run a provider-backed prompt without intentionally configured credentials and enabled models; report that as unperformed.

## Plan self-review

- Spec coverage: Tasks 1 and 2 implement JSON validation, rendering, safety, mappings, and documentation; Task 3 verifies provider-neutral delivery and separates static from provider-backed evidence.
- Placeholder scan: no deferred validation or unspecified implementation work remains.
- Interface consistency: all tasks use the same keys, flags, token, profile names, and collision semantics.
