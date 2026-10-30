import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DotNetPlugin, GraphBuilder, validateGraph } from '../understand-anything-plugin/packages/core/dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'ua-dotnet-smoke-'));
try {
  const sources = {
    'Form.vb': 'Friend Class Form\nPrivate Sub Press(sender As Object, e As System.EventArgs) Handles Button.Click\nEnd Sub\nEnd Class',
    'Form.Designer.vb': 'Partial Class Form\nPublic WithEvents Button As Object\nPublic Sub New()\nEnd Sub\nEnd Class',
    'Types.cs': 'namespace Demo; public enum State { On } public class Box { public int Run(int value) => value; public string Run(string value) => value; }',
  };
  writeFileSync(join(root, 'Demo.vbproj'), '<Project><PropertyGroup><RootNamespace>Demo</RootNamespace></PropertyGroup></Project>');
  for (const [path, source] of Object.entries(sources)) writeFileSync(join(root, path), source);
  const plugin = new DotNetPlugin({ projectRoot: root, csharp: true });
  plugin.prepare(Object.keys(sources));
  const builder = new GraphBuilder('Smoke', '');
  for (const [path, source] of Object.entries(sources)) {
    const analysis = plugin.analyzeFile(path, source);
    assert.equal(analysis.dotNet.syntaxStatus, 'complete');
    builder.addFileWithAnalysis(path, analysis, { summary: '', fileSummary: path, summaries: {}, tags: [], complexity: 'simple' });
  }
  const graph = builder.build();
  assert.equal(validateGraph(graph).success, true);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.equal(graph.nodes.filter(node => node.type === 'class' && node.name === 'Form').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'function' && node.name === 'Run').length, 2);
  assert.equal(graph.edges.filter(edge => edge.type === 'subscribes').length, 1);
  writeFileSync(join(root, 'Bad.vb'), 'Class Bad\nSub Run(\nEnd Class');
  plugin.prepare(['Bad.vb']);
  assert.equal(plugin.analyzeFile('Bad.vb', 'Class Bad\nSub Run(\nEnd Class').dotNet.syntaxStatus, 'recovered');
  console.log('PASS: Roslyn VB/C#, partial forms, overloads, event provenance, recovered-input status and graph schema.');
} finally {
  rmSync(root, { recursive: true, force: true });
}