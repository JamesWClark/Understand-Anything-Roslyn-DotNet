import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { values } = parseArgs({ options: { 'project-root': { type: 'string' }, 'output-root': { type: 'string' }, port: { type: 'string' } } });
  const configPath = join(homedir(), '.understand-anything-team', 'config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  const projectRoot = values['project-root'] ?? config.projectRoot;
  const outputRoot = values['output-root'] ?? config.outputRoot ?? projectRoot;
  if (!projectRoot || !outputRoot) throw new Error('Run setup-team.ps1 -ProjectRoot <path> or pass --project-root and --output-root.');
  const port = Number(values.port ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const dashboard = join(root, 'understand-anything-plugin/packages/dashboard');
  const require = createRequire(join(dashboard, 'package.json'));
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: dashboard, stdio: 'inherit', env: { ...process.env, GRAPH_DIR: realpathSync(outputRoot), UA_SOURCE_ROOT: realpathSync(projectRoot) },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}