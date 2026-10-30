# Understand Anything: Roslyn for .NET

This is a Roslyn-enabled fork of Understand Anything, not a .NET-only replacement. The normal `/understand` skill uses Roslyn syntax analysis for VB files; C# continues to use the existing tree-sitter provider by default, with Roslyn available by setting `UA_DOTNET_CSHARP=1`. The optional standalone structural graph command uses Roslyn for VB and C#.

There are two distinct ways to use the fork:

- **Copilot skill:** the normal workflow for VB, Python, Node.js, and polyglot repos. Install the fork once, open any application repo in VS Code, and run `/understand`. Its graph is saved in that repo's `.ua/` directory (or existing `.understand-anything/`). Enrichment uses your configured AI provider and may send source to it; use an approved provider for proprietary code.
- **Standalone .NET pilot:** an optional local-only structural graph for VB/C#. It does not use Copilot or generate LLM summaries.

Setup installs and builds the tool; it does not analyze an application. `-ProjectRoot` is optional and only selects a default for the standalone pilot. You do not rerun setup when switching application repos.

## Install Once on Windows

Prerequisites: Git, Node.js 22 or newer with npm/npx, and a .NET 10.0.4xx SDK compatible with [global.json](global.json). Setup uses the repository-pinned pnpm through npx; global pnpm is not required. Downloads use the machine's configured npm/NuGet feeds. No ANTLR, Rust, Emscripten, or VB grammar compilation is required.

For Copilot explanations, also install VS Code and GitHub Copilot, sign in with an organization-approved account, and enable agent/skill use according to your organization's policy. The structural CLI and browser dashboard work without an AI account. Installation needs access to GitHub, npm and NuGet (or approved mirrors).

Clone or obtain the application source separately through your organization's normal process. The tool fork does not include application source. The paths and filenames below are examples: substitute your own source checkout and files. You do not need to restore or build the application being analyzed.

The Roslyn implementation is merged into this fork's `main`. Clone the fork's default branch; the old `feature/roslyn-dotnet` branch is no longer needed for installation.

```powershell
git clone https://github.com/JamesWClark/Understand-Anything-Roslyn-DotNet.git
Set-Location Understand-Anything-Roslyn-DotNet
.\scripts\setup-dotnet.ps1
```

Run these commands in PowerShell from the tool checkout, not from the application directory. If your organization blocks script execution, use its approved procedure; setup does not change execution policy or bypass administrator restrictions.

Setup restores locked Node/NuGet dependencies, publishes the helper, builds core/skill/dashboard, runs synthetic smoke checks, and links skills under the current user's `.copilot/skills`. It never pulls Git changes or requests administrator elevation. Restart VS Code after installation. Keep the tool checkout at a stable path because the user-level skill links point into it.

If you rename or move the local checkout, rerun setup with `-ReplaceLinks` so the Copilot skill links point to its new path. Setup and standalone pilot state is stored under `%USERPROFILE%\.understand-anything-roslyn-dotnet`; it contains setup/link records and standalone pilot graphs, not application source.

To analyze a project with Copilot, open that project's repo in VS Code and run:

```text
/understand --full
/understand-dashboard
```

Use `--full` for the first graph. Later `/understand` runs are incremental by default. Repeat in each repo you want to analyze; no per-repo setup command is needed. VB files are routed to Roslyn automatically. Roslyn facts are syntax-only, not project-wide semantic binding, and the application is not restored or built.

If an existing junction points to another installation, inspect it and rerun with `-ReplaceLinks` only when you intend to replace it. Previous targets are recorded for uninstall. Real directories are never replaced. Use `-NoSkills` to build without installing links.

## Optional: Standalone .NET Structural Graph

Use this only when you want a local structural graph without Copilot enrichment. Choose an output folder outside the application repo. For example, analyze one form and its designer:

```powershell
$project = 'C:\src\MyApplication'
$output = Join-Path $HOME '.understand-anything-roslyn-dotnet\projects\my-application'
node scripts/analyze-dotnet.mjs --project-root $project --output-root $output `
  --include MainForm.vb --include MainForm.Designer.vb
node scripts/dotnet-dashboard.mjs --project-root $project --output-root $output
```

Omit the `--include` arguments to recursively analyze all `.vb` and `.cs` files under the selected root, honoring ignore rules and skipping symlinks. For multiple independent projects, use a separate output folder for each and pass the matching source/output paths to both commands. The dashboard prints a tokenized localhost URL. Its source viewer reads the source checkout, confined to paths present in the graph. No application code is executed. Use `--port 5174` if needed; Vite also chooses another port when the requested one is occupied.

The analyzer refuses to overwrite an existing graph unless `--force` is supplied. Avoid `--force` if you want to keep that graph. Setup's optional `-ProjectRoot` argument only saves a default project/output folder for `dotnet-dashboard.mjs`; it is not required for Copilot use or for the explicit commands above.

This first release walks source files rather than evaluating Compile items: conditional exclusions, linked files, shared/multiple projects, imported targets and multi-targeting are not fully modeled. Analyze one project directory at a time; ambiguous same-directory project files are reported as failures. `--configuration Release` selects a static Release-like context, not a full MSBuild evaluation.

Exit code 0 means selected files parsed cleanly, 2 means a graph/report was written with recovered or failed inputs, and 1 means a command/setup failure. Inspect `.ua/dotnet-analysis.json` (or the existing legacy data directory) for every file's diagnostics, source hash, provider identity and syntax-only status.

The initial graph contains declarations, merged partial types, overload-aware members, fields and syntax-based Handles relationships. It has no LLM business summaries or bound call graph. Namespaces/imports are not fabricated into file dependencies. Reflection and late binding remain unresolved. Fields and event expressions use existing resource/concept node types.

The standalone graph and Copilot-generated graph are separate outputs. `/understand` does not enrich the pilot graph in place; it writes to the application repo's `.ua/` directory (or existing `.understand-anything/`). No LLM run is part of setup.

VB fingerprints intentionally remain content-only. Changed VB files are classified conservatively; the existing strict validator cannot prove VB symbol deletions. If incremental validation cannot preserve symbols, rerun `/understand --full`; do not bypass its checks. The same conservative policy applies to opt-in Roslyn C# fingerprints. Project-wide semantic binding and parser-neutral strict deletion validation are future stages, not enabled features.

## Verify, Update and Uninstall

```powershell
.\scripts\setup-dotnet.ps1 -Check
git pull --ff-only
.\scripts\setup-dotnet.ps1
.\scripts\setup-dotnet.ps1 -Uninstall
```

Check mode does not restore/build, install links, or save project configuration. Uninstall removes only junctions still owned by this installation, restores available previous targets, and retains the checkout/configuration/graphs. Updates are explicit; use an approved tag/commit for rollout. This change is not automatically committed, pushed, or released.

The setup script is Windows-first. The helper, Node adapter and CLI can run on other platforms after equivalent dependency installation/builds, but no cross-platform setup script is supplied. .NET Framework 4.8 reference assemblies and Visual Studio/MSBuild are not prerequisites for syntax-only analysis. Loading/evaluating legacy projects, restoring/building applications, or executing targets requires separate approval and implementation.

## Maintainer Distribution

For maintainers, keep `origin` pointed at this Roslyn-enabled fork and `upstream` pointed at `Egonex-AI/Understand-Anything`. Create new feature branches from the fork's `main` and push them to `origin`. The Roslyn implementation is already merged into `main`; publish future implementation changes and setup documentation there before distributing them. Follow the repository's synchronized six-manifest versioning rule in [CLAUDE.md](CLAUDE.md) when pushing. Do not publish application source, generated project graphs, credentials or user-local configuration.

Before distributing a release, test the install, health check and a synthetic analysis from a fresh clone of the fork's `main`, ideally on another Windows account or machine. Record the approved commit or tag. The upstream marketplace package is not a substitute for this fork.

## Development Gates

```powershell
npx --yes pnpm@10.6.2 build:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core build
npx --yes pnpm@10.6.2 check:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

Roslyn packages are pinned with a NuGet lockfile. Keep the protocol version synchronized between the helper and adapter. Synthetic tests must not copy proprietary WIP source. A supported .NET SDK/helper build is required to exercise Roslyn integration tests; other-language tests remain usable without it. Build and package the local viewer when distributing it; do not silently download upstream viewer releases for this fork.