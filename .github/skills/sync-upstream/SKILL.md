---
name: sync-upstream
description: Assess and safely integrate upstream Understand Anything changes into this Roslyn .NET fork. Use for upstream syncs, merge-risk reviews, or upstream VB.NET/.NET analyzer changes. Never merge or push without explicit approval.
---

# Sync Upstream Safely

Use this skill from the Understand-Anything-Roslyn-DotNet checkout when reviewing changes from Egonex AI's upstream repository. The goal is to keep the fork current without losing its Roslyn integration or silently changing how VB.NET and C# are analyzed.

This repository is the plugin fork. Do not install a separate upstream plugin or substitute upstream build artifacts. Read `CLAUDE.md` and `DOTNET_SETUP.md` for current repository conventions and validation gates.

## Stage 1: Inspect Without Changing the Branch

1. Run `git status --short --branch`. If the worktree is dirty, stop before fetching or switching branches. Report the changed paths and ask the user to preserve or commit that work; never stash, discard, reset, or commit it yourself.
2. Run `git remote -v` and verify that `origin` points to this fork and `upstream` points to `Egonex-AI/Understand-Anything`. If either remote is absent or points elsewhere, report it and ask before changing remote configuration.
3. Confirm that local `main` exists. If `upstream/main` is not present locally, tell the user that fetching updates remote-tracking refs but does not merge code, then run `git fetch upstream`.
4. Compare the branches:

   ```text
   git log --oneline --left-right main...upstream/main
   git diff --stat main...upstream/main
   git diff --name-status main...upstream/main
   ```

5. Inspect the upstream commits and relevant diffs. Do not assess risk from filenames alone; read the changed code and tests, including any moved or deleted files.

Fetching is allowed for assessment after the worktree and remotes are verified. Do not switch branches, create a branch, merge, rebase, cherry-pick, resolve conflicts, or push during this stage.

## Stage 2: Assess Fork Compatibility

Compare upstream changes with the fork's Roslyn-sensitive integration points, including:

- `understand-anything-plugin/packages/core/src/plugins/dotnet-plugin.ts`
- `understand-anything-plugin/packages/core/src/analyzer/graph-builder.ts`
- `understand-anything-plugin/packages/core/src/languages/configs/vbnet.ts` and `configs/index.ts`
- `understand-anything-plugin/packages/core/src/plugins/registry.ts` and `types.ts`
- `understand-anything-plugin/skills/understand/create-analysis-registry.mjs`
- The `/understand` structure extraction, project scan, fingerprint, and incremental-update scripts and instructions
- The Roslyn helper under `understand-anything-plugin/tools/dotnet-analyzer/`
- Shared package manifests, build scripts, plugin manifests, and `extract-import-map.mjs`

For upstream VB.NET or .NET work, explicitly determine:

- Which analyzer claims `.vb` and the `vbnet` language ID. The current VB language config is not tree-sitter-backed; the fork registers `DotNetPlugin` for `vbnet` after the general tree-sitter plugin. `PluginRegistry` stores one plugin per language ID, so if upstream adds a VB provider, registration order could silently replace one even when Git reports no conflict.
- Whether the analyzer result still satisfies the shared `StructuralAnalysis` contract and the Roslyn-specific `analysis.dotNet` path in `GraphBuilder`.
- Whether source scanning, project context, analyzer protocol/schema, error recovery, and syntax-only limitations remain truthful and tested.
- Whether fingerprints and incremental updates preserve the fork's conservative VB behavior. Never treat missing VB symbols as confirmed deletions without a validator that supports that claim.
- Whether C# remains tree-sitter by default and only opts into Roslyn through the documented setting.
- Whether tests cover provider selection, VB graph construction, partial/designer declarations, recovered syntax, incremental changes, and the standalone analyzer as applicable.

Also inspect general shared-code overlaps. A textually clean merge can still cause behavioral regressions through changed types, registry defaults, import resolution, graph schema, or plugin wiring.

## Stage 3: Report and Ask Before Integration

Before changing branches, report:

- Upstream commits and how far the branches diverge
- Upstream files changed, including files also modified by this fork
- Specific textual conflicts and separate behavioral risks
- Any VB.NET/.NET implementation found upstream and whether it competes with the current provider
- The recommended integration approach and the validation commands required

Do not merge just because the user asked to check, fetch, assess, or prepare a sync. Ask for explicit approval before creating an integration branch or applying upstream commits. If the user declines or has not approved, finish with the assessment only.

## Stage 4: Integrate Only After Approval

After explicit approval, re-check that the worktree is clean, switch to the fork's `main`, and fast-forward it from `origin/main` with `git pull --ff-only origin main`. Create a uniquely named `sync/upstream-<timestamp>` branch from that fork `main`, then merge `upstream/main` with a merge commit. Do not rebase or force-push shared fork history unless the user specifically requests it.

Resolve conflicts by preserving both projects' intended behavior. Never resolve a whole file by choosing `ours` or `theirs`. For ambiguous analyzer ownership, graph schema, or incremental semantics, stop and ask the user rather than guessing. After resolving conflicts, inspect the complete merge diff and add or update focused tests for any changed behavior.

Run the applicable repository gates, normally:

```text
npx --yes pnpm@10.6.2 build:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core build
npx --yes pnpm@10.6.2 check:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

Do not install or replace dependencies without authorization if the package manager reports that it will remove existing `node_modules`. If a required gate fails, report the failure and do not promote the merge.

Promoting the integration branch to `main` and pushing are separate actions requiring explicit approval. Before any push, follow `CLAUDE.md`'s synchronized version-bump rule for all six manifests. Never publish application source, generated project graphs, credentials, or user-local configuration.

## Completion Report

Summarize what was fetched, what upstream changed, conflict and compatibility risks, tests run and their outcomes, and whether any merge or push occurred. Distinguish a successful Git merge from verified Roslyn behavior.