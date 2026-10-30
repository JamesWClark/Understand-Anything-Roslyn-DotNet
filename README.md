<h1 align="center">Understand Anything</h1>

## Understand Anything: Roslyn for .NET

This repository is the **Windows, VS Code, and GitHub Copilot fork** of [Understand Anything](https://github.com/Egonex-AI/Understand-Anything), the original project by Egonex AI. It retains the upstream project and its MIT license while adding Roslyn-based .NET analysis and a fork-specific setup workflow. The fork is maintained at [JamesWClark/Understand-Anything-Roslyn-DotNet](https://github.com/JamesWClark/Understand-Anything-Roslyn-DotNet).

**This checkout is the plugin.** The setup script builds this fork and registers its Copilot skills. Do not install a separate upstream marketplace plugin; it does not contain this fork's Roslyn changes.

The supported installation is **Windows + VS Code + GitHub Copilot**. This is not a VS Code extension and will not appear in the Extensions list. See [DOTNET_SETUP.md](DOTNET_SETUP.md) for the complete setup and .NET guide.

Understand Anything builds an interactive knowledge graph from a codebase. The graph is written to the application's `.ua/` directory, or its existing `.understand-anything/` directory for compatibility.

<p align="center">
	<img src="assets/hero.png" alt="Understand Anything interactive codebase knowledge graph dashboard" width="800" />
</p>

---

## Features

- Interactive code and architecture graph with search, relationships, and guided tours.
- Copilot skills for codebase questions, explanations, diff impact, onboarding, domain analysis, and knowledge-base analysis.
- Incremental re-analysis after the initial full run.
- Roslyn syntax analysis for VB.NET in the normal `/understand` workflow, with opt-in Roslyn for C#.
- A separate local-only structural analyzer for VB.NET and C#.

---

## Supported Setup

The supported installation is Windows PowerShell with VS Code and GitHub Copilot. This repository does not currently provide a supported installer or workflow for other AI coding platforms or operating systems.

Requirements: Git, Node.js 22 or newer, a .NET 10.0.4xx SDK compatible with [global.json](global.json), and VS Code with GitHub Copilot agent skills enabled. The setup script uses the repository-pinned pnpm through `npx`.

### Install this fork

Run these commands in PowerShell. Keep the checkout at a stable path because Copilot skill links point into it.

```powershell
git clone https://github.com/JamesWClark/Understand-Anything-Roslyn-DotNet.git
Set-Location Understand-Anything-Roslyn-DotNet
.\scripts\setup-dotnet.ps1
```

The setup builds this checkout's Roslyn helper, core, skills, and dashboard, then links the skills into your user-level Copilot configuration. It does not install a VS Code extension, analyze an application, or install a separate upstream plugin. Restart VS Code after setup. If you move or rename the checkout later, rerun setup with `-ReplaceLinks`.

### Analyze an application

Open the application repository in VS Code and run these in Copilot Chat's agent mode:

```text
/understand --full
/understand-dashboard
```

The first command creates the initial graph. Later `/understand` runs are incremental by default. You do not need to run setup in each application repository. Copilot enrichment uses your configured AI provider and may send source content to it; use an organization-approved provider for proprietary code.

Other available skills include `/understand-chat`, `/understand-diff`, `/understand-explain`, `/understand-onboard`, `/understand-domain`, and `/understand-knowledge`.

### .NET analysis

VB.NET files use Roslyn syntax analysis automatically in `/understand`. C# uses the existing tree-sitter provider by default; set `UA_DOTNET_CSHARP=1` to opt into Roslyn. This is syntax analysis, not project-wide semantic binding. The application is not restored or built.

For a separate local-only structural graph without Copilot enrichment, use the optional analyzer. Choose an output folder outside the application repository:

```powershell
$project = 'C:\src\MyApplication'
$output = Join-Path $HOME '.understand-anything-roslyn-dotnet\projects\my-application'
node scripts/analyze-dotnet.mjs --project-root $project --output-root $output
node scripts/dotnet-dashboard.mjs --project-root $project --output-root $output
```

See [DOTNET_SETUP.md](DOTNET_SETUP.md) for analyzer options, limitations, and diagnostics.

---

## Update, Check, or Uninstall

From the tool checkout, update from this fork's configured `origin`, then rebuild and relink:

```powershell
git pull --ff-only
.\scripts\setup-dotnet.ps1
```

Run `.\scripts\setup-dotnet.ps1 -Check` to check the installation without restoring or building. Run `.\scripts\setup-dotnet.ps1 -Uninstall` to remove links owned by this setup; the checkout and project graphs are retained. See [DOTNET_SETUP.md](DOTNET_SETUP.md) for details.

### Sync upstream changes (maintainers)

This updates the fork's source; it is separate from installing or updating the plugin. Keep `origin` pointed at this fork and `upstream` pointed at Egonex AI's original repository. If `upstream` is absent from `git remote -v`, add it once:

To have Copilot assess upstream changes without integrating them, run this in Copilot Chat:

```text
/sync-upstream Assess upstream/main, report what changed and any Roslyn/VB.NET risks, but do not merge or push.
```

The skill requires a clean worktree before fetching. It reports the changes and compatibility risks first; merging, promoting to `main`, and pushing require separate explicit approval.

```powershell
git remote -v
git remote add upstream https://github.com/Egonex-AI/Understand-Anything.git
```

Before each sync, commit or otherwise preserve local work and require a clean worktree. Review upstream on a temporary branch before advancing fork `main`:

```powershell
git status --short --branch
git switch main
git pull --ff-only origin main
git fetch upstream
git log --oneline --left-right main...upstream/main
git diff --name-status main...upstream/main
$syncBranch = "sync/upstream-$(Get-Date -Format yyyyMMdd-HHmmss)"
git switch -c $syncBranch
git merge --no-ff upstream/main
```

Resolve conflicts by preserving the intended upstream and fork behavior; do not choose one side wholesale. In the same PowerShell session, run the setup smoke check and test suites:

```powershell
.\scripts\setup-dotnet.ps1 -NoSkills
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

Review the result before promoting it:

```powershell
git switch main
git merge --ff-only $syncBranch
git push origin main
```

Fetching only updates the local `upstream/main` reference. The merge is what brings those commits into the fork. A conflict-free merge does not by itself prove the Roslyn integration still behaves correctly.

The fork routes `.vb` files through its Roslyn `DotNetPlugin`; the current VB language config is not tree-sitter-backed. The core graph builder also has a Roslyn-specific result path, and the `/understand` skill has fork-specific analyzer and conservative incremental-fingerprint handling. If upstream adds VB.NET or .NET analysis, review provider registration/selection, graph conversion, and incremental behavior together. `PluginRegistry` stores one analyzer per language ID, so make sure `.vb` files still have exactly one intended provider and C# remains tree-sitter by default unless opted in. Changed VB files must not be treated as verified symbol deletions. Exercise the Roslyn plugin tests, setup smoke check, core tests, and full test suite before promoting the merge. Shared files already overlap, including `extract-import-map.mjs` and package/plugin manifests, so inspect upstream's changed-file list on every sync.

## Share a Graph

The generated graph is JSON in the application repository's `.ua/` directory (or its existing `.understand-anything/` directory). It can be committed to share the analysis, excluding intermediate scratch data and local diff overlays:

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

---

## How Analysis Works

The normal `/understand` workflow combines deterministic syntax analysis with Copilot-generated summaries and explanations. VB.NET files use Roslyn automatically. C# uses tree-sitter by default, with Roslyn available by setting `UA_DOTNET_CSHARP=1`.

The Roslyn integration is syntax-only. It does not perform project-wide semantic binding, evaluate MSBuild project files, restore dependencies, build the application, or execute application code. The optional standalone analyzer writes a separate structural graph; it does not enrich the Copilot-generated graph in place.

## Development

The setup and verification instructions for this fork are in [DOTNET_SETUP.md](DOTNET_SETUP.md). The setup script is Windows-first and provisions the VS Code/Copilot workflow; equivalent Roslyn setup workflows for other platforms are not currently maintained here.

## Attribution and License

This fork builds on [Egonex AI's Understand Anything](https://github.com/Egonex-AI/Understand-Anything). Upstream authorship and license notices are retained in [LICENSE](LICENSE). Fork-specific Roslyn integration, Windows setup, and documentation are maintained in this repository.
