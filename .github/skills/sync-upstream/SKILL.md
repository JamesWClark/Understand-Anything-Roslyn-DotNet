---
name: sync-upstream
description: "Use when assessing or integrating Egonex AI upstream changes into the Understand-Anything-Roslyn-DotNet fork. Guides a human-approved sync from read-only assessment through merge, tests, local promotion, and optional push, with specific Roslyn/VB.NET risk checks."
---

# Guided Upstream Sync

Guide the user through bringing `Egonex-AI/Understand-Anything` changes into this Roslyn-enabled fork. Automate inspection, diff analysis, safe branch operations, clear conflict resolutions, and validation. Ask the user at consequential decision points and offer the next step after each completed stage. Do not stop after the assessment unless the user chooses assessment-only or explicitly prohibits integration.

This checkout is the plugin fork. Never install a separate upstream plugin or substitute upstream build artifacts. Read `CLAUDE.md` and `README.md` for current conventions. The current supported setup/integration target is Windows + VS Code + GitHub Copilot.

## Interaction Rules

- Treat `/sync-upstream` without restrictive arguments as a request to begin the guided sync, not as permission to merge or push.
- Parse explicit user constraints. “Assess only”, “do not merge”, or “do not push” remain in force for the whole run.
- Use `vscode_askQuestions` for decision gates when available. Ask one gate at a time, show a recommended option when evidence supports one, and explain what each option does.
- Every choice prompt must list only the relevant concrete actions; do not add a separate custom-response option. Keep the question's freeform response field enabled with `allowFreeformInput: true`, so the user can type an alternative there. Never treat freeform text as approval for merge, promotion, push, dependency script execution, or another gated action unless the user clearly says so.
- Use this shape for each question:

   ```text
   options: [relevant concrete actions...]
   allowFreeformInput: true
   ```
- After every completed stage, report what changed and offer the next decision. If the user pauses, leave the current branch/worktree in a clearly reported resumable state; on a later invocation, inspect Git state and resume rather than starting over.
- Do routine read-only work autonomously. Never stash, discard, reset, amend, force-push, or overwrite user changes. A merge commit on the approved sync branch is allowed only after the user selects integration.
- Fetching updates remote-tracking refs only. Explain that it does not merge code.

## Stage 1: Preflight

1. Inspect Git state before fetching:

   ```text
   git status --short --branch
   git branch --show-current
   ```

   If a merge, rebase, or cherry-pick is already in progress, stop and explain the state. If the worktree is dirty, do not fetch or switch. Report the changed paths and offer stopping until the user preserves them or assessing only already-fetched refs with a stale-result warning. Keep freeform enabled for another instruction. Never commit or stash for the user.

2. Verify remotes:

   ```text
   git remote -v
   ```

   `origin` should be `https://github.com/JamesWClark/Understand-Anything-Roslyn-DotNet.git`; `upstream` should be `https://github.com/Egonex-AI/Understand-Anything.git`. If a remote is missing or stale, verify the intended URL with `git ls-remote` first, then offer updating it to the verified URL or leaving it unchanged and stopping. Keep freeform enabled. Do not change remote configuration before the user chooses.

3. Confirm local `main` exists. If clean and remotes are correct, refresh refs:

   ```text
   git fetch origin
   git fetch upstream
   ```

4. If the user is already on `sync/upstream-*`, inspect its parent/merge state and resume that integration rather than creating another branch. Otherwise, make no branch changes during assessment.

## Stage 2: Assess Upstream

Compare the fork and upstream:

```text
git rev-list --left-right --count main...upstream/main
git log --oneline --left-right main...upstream/main
git diff --stat main...upstream/main
git diff --name-status main...upstream/main
```

Read each upstream commit and inspect the changed code and tests, including renames and deletions. Compare changed paths against fork-only changes. Run a non-mutating merge simulation:

```text
git merge-tree --write-tree main upstream/main
```

Report the commit counts, upstream changes, overlapping files, predicted textual conflicts, behavioral risks, and the next validation steps. A clean merge simulation is not proof of behavioral compatibility.

Inspect these fork integration points when relevant:

- `understand-anything-plugin/packages/core/src/plugins/dotnet-plugin.ts`
- `understand-anything-plugin/packages/core/src/analyzer/graph-builder.ts`
- `understand-anything-plugin/packages/core/src/languages/configs/vbnet.ts` and `configs/index.ts`
- `understand-anything-plugin/packages/core/src/plugins/registry.ts` and `types.ts`
- `understand-anything-plugin/skills/understand/create-analysis-registry.mjs`
- `/understand` structure extraction, scanning, fingerprints, incremental updates, and instructions
- `understand-anything-plugin/tools/dotnet-analyzer/`
- Shared manifests, build scripts, plugin wiring, and `extract-import-map.mjs`

For upstream VB.NET/.NET support, explicitly check:

- Which provider owns `.vb` and language ID `vbnet`. The current VB config is not tree-sitter-backed; `DotNetPlugin` provides VB analysis. `PluginRegistry` stores one provider per language ID, so a new provider can silently displace another based on registration order without a textual conflict.
- Whether `StructuralAnalysis`, the Roslyn-specific `analysis.dotNet` graph-builder path, project context, analyzer protocol/schema, and syntax-only claims still agree.
- Whether C# remains tree-sitter by default and Roslyn remains opt-in via `UA_DOTNET_CSHARP=1`.
- Whether incremental fingerprints preserve conservative VB handling. Never interpret missing VB symbols as confirmed deletions unless a validator supports that conclusion.
- Whether tests cover provider selection, VB graph construction, partial/designer declarations, recovered syntax, incremental changes, and standalone analysis as applicable.

Also review general contract changes in graph schema, language defaults, imports, and manifests. Compare all six versioned manifests with the upstream result; `CLAUDE.md` lists them.

### Decision 1: Integrate?

After presenting the assessment, use `vscode_askQuestions` and ask the user to choose:

- **Create sync branch and integrate**: proceed to Stage 3.
- **Stop after assessment**: make no branch or source changes.

Keep the question's freeform response field enabled for alternatives.

If the user explicitly requested assessment-only or prohibited merging, report the findings and stop without offering integration as an action to take now.

## Stage 3: Create and Merge the Sync Branch

Only after the user selects integration:

1. Recheck that the worktree is clean and no Git operation is in progress.
2. Compare `main` with `origin/main`. If local `main` is only behind, offer fast-forwarding it before branching or stopping with it unchanged. If branches diverged or local commits are unpublished, explain the divergence and offer safe base choices for that situation; do not discard or rebase those commits. Keep freeform enabled for an alternative.
3. Create a unique `sync/upstream-<timestamp>` branch from the agreed fork `main` base.
4. Merge `upstream/main` with a merge commit:

   ```text
   git merge --no-ff upstream/main
   ```

5. Resolve clear mechanical conflicts by preserving both changes and inspect the full result. Never choose `ours` or `theirs` for an entire file. If analyzer ownership, graph schema, fingerprint semantics, or any other behavior is ambiguous, present the concrete resolutions needed with `vscode_askQuestions` and wait for the user's choice. Keep freeform enabled; do not add a duplicate custom option.
6. If the user chooses to pause or stop during a conflict, do not abort or discard the merge state automatically. Offer resuming conflict resolution or keeping the merge paused, with freeform enabled for another instruction. Aborting requires explicit confirmation.

## Stage 4: Validate the Integration

Inspect the complete merge diff and add/update focused tests for changed behavior. Run the relevant focused tests first, then the normal fork gates as applicable:

```text
npx --yes pnpm@10.6.2 build:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core build
npx --yes pnpm@10.6.2 check:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

Do not run `pnpm approve-builds` or allow dependency scripts broadly. If install/setup asks to remove and recreate `node_modules`, ask whether to proceed or cancel and leave freeform enabled. Approve only a specifically reviewed dependency script, and keep the workspace policy consistent with pinned pnpm 10.6.2. If a dependency approval prompt appears, identify the exact package and ask before approving it; leave freeform enabled without adding a separate custom option.

If a gate fails, inspect the cause. Fix and rerun clearly integration-related defects when the repair is local and unambiguous. For ambiguous failures, unrelated baseline failures, or dependency/environment problems, report the exact failure and use `vscode_askQuestions` to offer relevant concrete next steps with freeform enabled; do not promote an unvalidated merge. Treat non-fatal build warnings separately from failed gates.

### Decision 2: Promote to Local `main`?

After validation, report test results and use `vscode_askQuestions` to ask:

- **Keep the validated sync branch** for later review.
- **Fast-forward local `main`** to the validated sync branch.

Keep the question's freeform response field enabled for alternatives.

Do not switch or merge into `main` until the user chooses promotion. If local `main` or `origin/main` advanced during validation, re-check ancestry and ask how to proceed rather than forcing it.

### Decision 3: Push?

After local promotion—or if the user explicitly requests a push from the validated branch—ask separately whether to push. Before pushing:

1. Confirm the target remote is the fork's `origin` and the target branch is correct.
2. Follow `CLAUDE.md`'s six-manifest synchronized version bump. If no version was specified, propose the next version and use `vscode_askQuestions` to offer confirming it or deferring the push. Keep freeform input enabled for another version or instruction.
3. Re-run affected build/tests after the version change and inspect the push diff.
4. Use `vscode_askQuestions` for the final push choice: offer pushing to the verified fork branch or leaving the validated work local. Keep freeform input enabled for other instructions. Push only after an explicit yes. Never force-push.

If the user declines, leave the validated local result in place and report its branch/commit. Never publish application source, generated graphs, credentials, or user-local config.

## Completion Report

At each stop or completion, summarize what was fetched, what upstream changed, textual and behavioral risks, tests run and results, current branch/commit, and whether local promotion or push occurred. Distinguish a Git merge from verified Roslyn behavior. Always identify the next available step so the user can continue the workflow.