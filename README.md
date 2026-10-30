<h1 align="center">Understand Anything</h1>

# Understand Anything: Roslyn for .NET

This Windows, VS Code, and GitHub Copilot fork builds on [Understand Anything](https://github.com/Egonex-AI/Understand-Anything), originally created by Egonex AI. It adds Roslyn-based VB.NET analysis. Original authorship and the MIT license are acknowledged in [LICENSE](LICENSE).

<p align="center">
  <img src="assets/hero.png" alt="Understand Anything interactive codebase knowledge graph dashboard" width="800" />
</p>

## Use It

This checkout is the plugin. The supported setup is Windows, VS Code, and GitHub Copilot. Requirements: Git, Node.js 22+, .NET 10.0.4xx, and VS Code with Copilot agent skills enabled. From PowerShell, run:

```powershell
git clone https://github.com/JamesWClark/Understand-Anything-Roslyn-DotNet.git
Set-Location Understand-Anything-Roslyn-DotNet
.\scripts\setup-dotnet.ps1
```

Setup builds the Roslyn helper and plugin, then links skills into `%USERPROFILE%\.copilot\skills`. It is a one-time per-user setup, not a VS Code extension and not a per-project install.

Open any codebase in VS Code, start Copilot Chat in agent mode, and run:

```text
/understand --full
/understand-dashboard
```

Use `--full` for the first graph. Later `/understand` runs are incremental. Other skills include `/understand-chat`, `/understand-diff`, `/understand-explain`, `/understand-onboard`, `/understand-domain`, and `/understand-knowledge`.

Copilot enrichment uses your configured AI provider and may send source content to it. Use an organization-approved provider for proprietary code.

## .NET Behavior

VB.NET files use Roslyn syntax analysis in `/understand`. C# uses tree-sitter by default; set `UA_DOTNET_CSHARP=1` to opt into Roslyn. This is syntax analysis, not project-wide semantic binding; the application is not restored or built. The optional `scripts/analyze-dotnet.mjs` command writes a separate local structural graph.

## Supported Environment

The setup, global Copilot skill linking, and integration smoke checks currently target **Windows + VS Code + GitHub Copilot**. Other editors are not currently supported or tested.

Upstream assessment and sync guidance lives in the repo-local [sync-upstream skill](.github/skills/sync-upstream/SKILL.md). In Copilot Chat, run:

```text
/sync-upstream Assess upstream/main, report what changed and any Roslyn/VB.NET risks, but do not merge or push.
```

## Other Editor Support: TODO

- [ ] Choose the next editor and define its supported workflow.
- [ ] Add editor-specific skill discovery/linking without relying on the removed upstream installers.
- [ ] Add a clean-install smoke test and concise setup documentation for that editor.
