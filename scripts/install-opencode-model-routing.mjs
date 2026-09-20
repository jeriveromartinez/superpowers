import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const profiles = [
  { key: 'expert', name: 'superpowers-expert.md' },
  { key: 'main', name: 'superpowers-main.md' },
  { key: 'economic', name: 'superpowers-economic.md' },
];

try {
  const { configDir, modelsFile } = parseArguments(process.argv.slice(2));
  const models = readModelsFile(modelsFile);
  const agentsDir = path.join(configDir, 'agents');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const sourceDir = path.resolve(scriptDir, '..', 'opencode', 'model-routing', 'agents');

  const copies = profiles.map(({ key, name }) => {
    const source = path.join(sourceDir, name);
    ensureFile(source);
    return {
      destination: path.join(agentsDir, name),
      content: renderProfile(fs.readFileSync(source, 'utf8'), models[key]),
    };
  });

  const collisions = copies.filter(({ destination }) => destinationExists(destination));
  if (collisions.length > 0) {
    throw new Error(collisions.map(({ destination }) => `Collision: ${destination}`).join('\n'));
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  ensureDirectory(configDir);
  ensureDirectory(agentsDir);

  for (const { destination, content } of copies) {
    fs.writeFileSync(destination, content, { flag: 'wx' });
    console.log(destination);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function usage() {
  return 'Usage: node scripts/install-opencode-model-routing.mjs --config-dir <path> --models-file <path>';
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--config-dir', '--models-file'].includes(flag) || values.has(flag) || !value || value.startsWith('-')) throw new Error(usage());
    values.set(flag, value);
  }
  if (args.length !== 4 || values.size !== 2) throw new Error(usage());
  return {
    configDir: path.resolve(values.get('--config-dir')),
    modelsFile: path.resolve(values.get('--models-file')),
  };
}

function readModelsFile(modelsFile) {
  let models;
  try {
    models = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid models file ${modelsFile}: ${error.message}`);
  }
  if (!models || Array.isArray(models) || typeof models !== 'object') throw new Error('Models file must contain a JSON object');
  const expected = new Set(profiles.map(({ key }) => key));
  const keys = Object.keys(models);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) throw new Error('Models file must contain exactly: expert, main, economic');
  for (const key of expected) {
    if (typeof models[key] !== 'string' || !/^[^\r\n/]+\/[^\r\n/]+$/.test(models[key])) throw new Error(`Invalid model for ${key}: expected provider/model`);
  }
  return models;
}

function renderProfile(source, model) {
  const token = '{{MODEL}}';
  const occurrences = source.split(token).length - 1;
  if (occurrences !== 1) throw new Error('Expected exactly one {{MODEL}} token in profile template');
  return source.replace(token, model);
}

function ensureDirectory(target) {
  if (!fs.statSync(target).isDirectory()) throw new Error(`Expected directory: ${target}`);
}

function ensureFile(target) {
  if (!fs.statSync(target).isFile()) throw new Error(`Expected profile file: ${target}`);
}

function destinationExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
