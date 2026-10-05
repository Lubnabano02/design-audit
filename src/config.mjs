import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** "env:NAME" reads from the environment. Anything else is used literally. */
function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('env:')) return process.env[v.slice(4)] ?? null;
  return v;
}

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`File not found: ${file}`);
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

export async function loadConfig(configPath) {
  const config = await readJSON(configPath);
  const dir = path.dirname(path.resolve(configPath));
  const rel = p => (p ? path.resolve(dir, p) : null);

  config.figma = {
    fileKey: resolveValue(config.figma?.fileKey),
    token: resolveValue(config.figma?.token) ?? process.env.FIGMA_TOKEN ?? null,
  };
  config._dir = dir;
  config._tokensPath = rel(config.tokensFile);
  config._exceptionsPath = rel(config.exceptionsFile);
  config._outDir = rel(config.outDir ?? './audit-runs');

  const problems = [];
  if (!config.baseUrl) problems.push('baseUrl is required');
  if (!Array.isArray(config.screens) || !config.screens.length) problems.push('at least one screen is required');
  for (const [i, s] of (config.screens ?? []).entries()) {
    if (!s.name) problems.push(`screens[${i}] needs a name`);
    if (!s.path) problems.push(`screens[${i}] needs a path`);
  }
  if (problems.length) throw new Error('Invalid config:\n  - ' + problems.join('\n  - '));

  return config;
}

export async function loadTokens(file) {
  const t = await readJSON(file);
  if (!t.color && !t.type && !t.spacing && !t.contrast && !t.targetSize) {
    throw new Error(`${file} has no recognised token groups (color, type, spacing, contrast, targetSize).`);
  }
  return t;
}

export async function loadExceptions(file) {
  if (!file) return { exceptions: [] };
  try {
    return await readJSON(file);
  } catch (err) {
    if (/not found/.test(err.message)) return { exceptions: [] };
    throw err;
  }
}
