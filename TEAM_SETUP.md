# Team Setup: VB.NET and C#

This fork adds a Roslyn syntax provider to Understand-Anything. VB uses Roslyn in the bundled analysis scripts. C# keeps its existing tree-sitter default; set `UA_DOTNET_CSHARP=1` to opt into Roslyn there. The standalone structural graph command uses Roslyn for both languages.

## Install on Windows

Prerequisites: Git, Node.js 22 or newer with npm/npx, and a .NET 10.0.4xx SDK compatible with [global.json](global.json). Setup uses the repository-pinned pnpm through npx; global pnpm is not required. Downloads use the machine's configured npm/NuGet feeds. No ANTLR, Rust, Emscripten, or VB grammar compilation is required.

For Copilot explanations, also install VS Code and GitHub Copilot, sign in with a team-approved account, and enable agent/skill use according to your organization policy. The structural CLI and browser dashboard work without an AI account. Installation needs access to GitHub, npm and NuGet (or approved mirrors).

Clone or obtain the application source separately through your team's normal process. The tool fork does not include WIP or other proprietary application source. The paths and Signon filenames below are examples: substitute your own source checkout and files. You do not need to restore or build the application being analyzed.

The implementation must be committed and pushed before another teammate can install it. Until it is merged into the fork's default branch, use the published feature branch below. These steps do not publish local changes automatically.

```powershell
git clone --branch feature/roslyn-dotnet https://github.com/JamesWClark/Understand-Anything-Team.git
Set-Location Understand-Anything-Team
.\scripts\setup-team.ps1 -ProjectRoot 'C:\src\Cibar\GTS.Base\Cib\Wip'
```

Run these commands in PowerShell from the tool checkout, not from the application directory. If your organization blocks script execution, use its approved procedure; setup does not change execution policy or bypass administrator restrictions.

Setup restores locked Node/NuGet dependencies, publishes the helper, builds core/skill/dashboard, runs synthetic smoke checks, and links skills under the current user's `.copilot/skills`. It never pulls Git changes or requests administrator elevation. Restart VS Code after installation.

If an existing junction points to another installation, inspect it and rerun with `-ReplaceLinks` only when you intend to replace it. Previous targets are recorded for uninstall. Real directories are never replaced. Use `-NoSkills` to build without installing links.

## Generate a Structural Graph

Use the source/output paths printed by setup. The output directory is under the current user's `.understand-anything-team/projects`, separate from WIP. Start with a small form and include its designer:

```powershell
node scripts/analyze-dotnet.mjs --project-root 'C:\src\Cibar\GTS.Base\Cib\Wip' `
  --output-root 'C:\path\printed\by\setup' `
  --include Signon.vb --include Signon.Designer.vb
node scripts/team-dashboard.mjs
```

The dashboard prints a tokenized localhost URL. Its source viewer reads the actual source checkout, confined to paths present in the graph. No application code is executed. Use `--port 5174` if needed; Vite also chooses another port when the requested one is occupied.

For the first-run check, confirm the synthetic smoke test passes during setup, the selected files appear under **Files**, and double-click a file to open its source. Use the URL printed on your machine, not another user's tokenized URL. Keep the dashboard terminal running; press Ctrl+C to stop it.

On later days, return to the tool checkout and run `node scripts/team-dashboard.mjs`; it reopens the last configured project's saved graph. Source edits do not automatically regenerate that graph. Rerun the analysis command when needed, observing the overwrite warning below. To switch projects, rerun setup with the new `-ProjectRoot`; only the selected default changes, and previously generated project outputs remain on disk.

Omit the `--include` arguments to recursively analyze all `.vb` and `.cs` files under the selected root, honoring ignore rules and skipping symlinks. This first release walks source files rather than evaluating Compile items: conditional exclusions, linked files, shared/multiple projects, imported targets and multi-targeting are not fully modeled. Analyze one project directory at a time; ambiguous same-directory project files are reported as failures. `--configuration Release` selects a static Release-like context, not a full MSBuild evaluation.

Existing graphs are not overwritten unless `--force` is supplied. Do not use `--force` on an enriched graph you want to keep; choose another output directory. Exit code 0 means selected files parsed cleanly, 2 means a graph/report was written with recovered or failed inputs, and 1 means a command/setup failure. Inspect `.ua/dotnet-analysis.json` (or the existing legacy data directory) for every file's diagnostics, source hash, provider identity and syntax-only status.

The initial graph contains declarations, merged partial types, overload-aware members, fields and syntax-based Handles relationships. It has no LLM business summaries or bound call graph. Namespaces/imports are not fabricated into file dependencies. Reflection and late binding remain unresolved. Fields and event expressions use existing resource/concept node types.

## Generate Explanations with Copilot

Open the intended WIP project in VS Code and invoke `/understand --full`, or ask Copilot to use the understand skill for that exact project path. Use an approved AI service: structural extraction runs locally, but enrichment can send proprietary source to the configured model. No credentials are stored by setup.

The normal skill workflow writes to WIP's own `.ua` directory (or legacy `.understand-anything`), unlike the external structural pilot. These are separate outputs. Do not expect the pilot graph to be enriched in place automatically. No LLM run is part of setup.

VB fingerprints intentionally remain content-only. Changed VB files are classified conservatively; the existing strict validator cannot prove VB symbol deletions. If incremental validation cannot preserve symbols, rerun `/understand --full`; do not bypass its checks. The same conservative policy applies to opt-in Roslyn C# fingerprints. Project-wide semantic binding and parser-neutral strict deletion validation are future stages, not enabled features.

## Verify, Update and Uninstall

```powershell
.\scripts\setup-team.ps1 -Check
git pull --ff-only
.\scripts\setup-team.ps1 -ProjectRoot 'C:\src\Cibar\GTS.Base\Cib\Wip'
.\scripts\setup-team.ps1 -Uninstall
```

Check mode does not restore/build, install links, or save project configuration. Uninstall removes only junctions still owned by this installation, restores available previous targets, and retains the checkout/configuration/graphs. Updates are explicit; use a team-approved tag/commit for rollout. This change is not automatically committed, pushed, or released.

The setup script is Windows-first. The helper, Node adapter and CLI can run on other platforms after equivalent dependency installation/builds, but no cross-platform team installer is supplied. .NET Framework 4.8 reference assemblies and Visual Studio/MSBuild are not prerequisites for syntax-only analysis. Loading/evaluating legacy projects, restoring/building WIP, or executing targets requires separate approval and implementation.

## Publish for Teammates

Maintainers must commit all implementation files, scripts, documentation and dependency lockfiles, then push `feature/roslyn-dotnet` to this fork before distributing the clone command. Follow the repository's synchronized six-manifest versioning rule in [CLAUDE.md](CLAUDE.md) when pushing. Do not publish application source, generated project graphs, credentials or user-local configuration.

Before a team rollout, test the install, health check and a synthetic analysis from a fresh clone of the published branch, ideally on another Windows account or machine. The current development checkout has passed tests and a WIP pilot; that is not a clean-machine installation guarantee. Record the approved commit or tag so teammates use the same revision. The upstream marketplace package is not a substitute for this fork.

## Development Gates

```powershell
npx --yes pnpm@10.6.2 build:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core build
npx --yes pnpm@10.6.2 check:team
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

Roslyn packages are pinned with a NuGet lockfile. Keep the protocol version synchronized between the helper and adapter. Synthetic tests must not copy proprietary WIP source. A supported .NET SDK/helper build is required to exercise Roslyn integration tests; other-language tests remain usable without it. Build and package the local viewer when distributing it; do not silently download upstream viewer releases for this fork.