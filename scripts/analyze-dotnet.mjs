import { parseArgs } from 'node:util';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DotNetPlugin, GraphBuilder, createIgnoreFilter, resolveUaDir, saveGraph, validateGraph } from '../understand-anything-plugin/packages/core/dist/index.js';

export async function analyzeDotNet({ projectRoot, outputRoot, includes = [], force = false, configuration = 'Debug' }) {
  projectRoot = resolve(projectRoot);
  outputRoot = resolve(outputRoot ?? projectRoot);
  const dataDir = resolveUaDir(outputRoot);
  if (existsSync(join(dataDir, 'knowledge-graph.json')) && !force) throw new Error('Graph already exists; choose another --output-root or explicitly pass --force.');
  const ignored = createIgnoreFilter(projectRoot);
  const paths = [];
  function visit(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const absolute = join(directory, item.name);
      const path = relative(projectRoot, absolute).replaceAll('\\', '/');
      if (ignored.isIgnored(path)) continue;
      if (item.isDirectory()) visit(absolute);
      else if (/\.(vb|cs)$/i.test(item.name)) paths.push(path);
    }
  }
  if (includes.length) paths.push(...includes.map(path => path.replaceAll('\\', '/')));
  else visit(projectRoot);
  const selected = [...new Set(paths)].sort();
  if (!selected.length) throw new Error('No .vb or .cs sources selected.');
  const plugin = new DotNetPlugin({ projectRoot, csharp: true, configuration });
  plugin.prepare(selected);
  const revision = spawnSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const gitHash = revision.status === 0 ? revision.stdout.trim() : '';
  const builder = new GraphBuilder(basename(projectRoot), gitHash);
  const results = [];
  const failures = [];
  for (const path of selected) {
    try {
      const source = readFileSync(join(projectRoot, path), 'utf8');
      const analysis = plugin.analyzeFile(path, source);
      results.push(analysis.dotNet);
      builder.addFileWithAnalysis(path, analysis, {
        summary: '', fileSummary: `${path}: ${analysis.dotNet.syntaxStatus} syntax; semantic binding not performed.`,
        summaries: {}, tags: ['dotnet', 'structural-analysis', ...(analysis.dotNet.syntaxStatus === 'recovered' ? ['incomplete'] : [])], complexity: 'moderate',
      });
    } catch (error) {
      failures.push({ path, message: error.message });
      builder.addFile(path, { summary: 'Analysis failed: ' + error.message, tags: ['dotnet', 'analysis-failed'], complexity: 'moderate' });
    }
  }
  const graph = builder.build();
  graph.project.description = 'Roslyn structural graph. No LLM summaries or project-wide semantic binding. See dotnet-analysis.json for diagnostics and coverage.';
  graph.layers = [{ id: 'dotnet-structure', name: '.NET Structure', description: 'Source declarations and syntax relationships', nodeIds: graph.nodes.map(node => node.id) }];
  const validation = validateGraph(graph);
  if (!validation.success || validation.issues.length) throw new Error('Graph validation failed: ' + JSON.stringify(validation));
  mkdirSync(dataDir, { recursive: true });
  const report = { protocolVersion: 1, semanticStatus: 'syntax-only', configuration, filesSelected: selected.length,
    filesAnalyzed: results.length, recoveredFiles: results.filter(result => result.syntaxStatus === 'recovered').map(result => result.path), failures, results };
  writeFileSync(join(dataDir, 'dotnet-analysis.json'), JSON.stringify(report, null, 2));
  saveGraph(outputRoot, graph);
  console.log(JSON.stringify({ outputRoot, files: selected.length, analyzed: results.length, recovered: report.recoveredFiles.length,
    failed: failures.length, nodes: graph.nodes.length, edges: graph.edges.length }, null, 2));
  return { graph, report, outputRoot };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'project-root': { type: 'string' }, 'output-root': { type: 'string' },
      include: { type: 'string', multiple: true }, force: { type: 'boolean' }, configuration: { type: 'string' } } });
    if (!values['project-root']) throw new Error('Usage: node scripts/analyze-dotnet.mjs --project-root <path> [--output-root <path>] [--include file.vb] [--force]');
    const result = await analyzeDotNet({ projectRoot: values['project-root'], outputRoot: values['output-root'], includes: values.include,
      force: values.force, configuration: values.configuration });
    if (result.report.failures.length || result.report.recoveredFiles.length) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}