export async function createAnalysisRegistry(core, projectRoot, paths) {
  const configs = core.builtinLanguageConfigs.filter(config => config.treeSitter);
  const treeSitter = new core.TreeSitterPlugin(configs);
  await treeSitter.init();
  const registry = new core.PluginRegistry();
  registry.register(treeSitter);
  core.registerAllParsers(registry);
  const csharp = process.env.UA_DOTNET_CSHARP === '1';
  let dotNet;
  if (paths.some(path => /\.vb$/i.test(path) || (csharp && /\.cs$/i.test(path)))) {
    dotNet = new core.DotNetPlugin({
      projectRoot,
      csharp,
      configuration: process.env.UA_DOTNET_CONFIGURATION ?? 'Debug',
    });
    dotNet.prepare(paths);
    registry.register(dotNet);
  }
  const structuralFingerprintLanguages = new Set(configs.map(config => config.id));
  if (csharp) structuralFingerprintLanguages.delete('csharp');
  return { registry, dotNet, structuralFingerprintLanguages };
}