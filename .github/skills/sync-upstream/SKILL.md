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
- Do routine read-only work autonomously. Never stash, discard, reset, amend, force-push, or overwrite user changes. A merge commit on the approved sync branch is allowed only after the user selects integration. After validation, a separate commit containing only the changelog record is allowed as described below; never include unrelated or user changes.
- Fetching updates remote-tracking refs only. Explain that it does not merge code.

## Verified Changelog and Rollback Tags

- `CHANGELOG.md` is the source of truth for the latest verified code commit. Read its newest entry during preflight and confirm the tag resolves to the recorded full commit hash with `git rev-parse <tag>^{}`.
- Keep annotated verification tags immutable and local unless the user explicitly approves pushing. Never move or delete an earlier verification tag; choose a unique name if one already exists.
- For a new changelog with no verified entry, bootstrap only from a commit the user identifies as working. Create an annotated tag on that exact commit and record its full hash, tag, branch, and how verification was established. Label user-confirmed baselines accurately; do not imply tests were run when they were not.
- After the required validation passes, tag the exact tested code commit before making changelog-only commits. Use `verified-main-YYYY-MM-DD` for a main baseline and `verified-sync-YYYY-MM-DD-<short-hash>` for a validated sync. Confirm the tag peels to the tested commit, then add a newest-first entry to `CHANGELOG.md` with the full hash, tag, summary, and the focused checks and results. Preserve prior entries as rollback history.
- If validation fails or remains incomplete, do not create a new verified tag or replace the latest known-good entry. Keep the existing rollback anchor and report the failure or gap.
- A changelog-only commit may follow the annotated tag; the tag intentionally identifies the tested code state, while the entry records that state. Do not tag the changelog-recording commit as verified unless its code was also validated.

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

Assess proportionally to the changed paths; commit count alone is not a risk score. For each changed path, inspect the relevant code/tests and nearest owning abstraction, including renames and deletions, and compare with fork-only changes. Do not re-audit the entire Roslyn pipeline unless the delta touches or depends on it. Run a non-mutating merge simulation:

```text
git merge-tree --write-tree main upstream/main
```

For a small localized delta with no Roslyn-sensitive overlap and a clean merge simulation, give a concise assessment of the changed paths, direct risks, and focused tests. Recommend the fast path: merge only after the user chooses, then run those focused checks without the full root suite or unrelated Roslyn gates. Widen review and validation when shared contracts, cross-cutting workflows, Roslyn ownership, or focused failures warrant it. A clean merge simulation is not proof of behavioral compatibility.

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

Review only directly affected general contracts such as graph schema, language defaults, imports, or manifests. Compare versioned manifests when metadata changes; check all six before a push as `CLAUDE.md` requires.

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

Inspect the merge diff and add/update focused tests for changed behavior. Select validation from the changed paths; do not run the full root suite by default for a small localized delta.

Typical focused checks:

| Upstream change | Focused validation |
| --- | --- |
| Python import resolution | `npx --yes pnpm@10.6.2 exec vitest run tests/skill/understand/test_extract_import_map.test.mjs -t "Python resolver"` |
| Makefile parsing | `npx --yes pnpm@10.6.2 --filter @understand-anything/core exec vitest run src/__tests__/parsers.test.ts -t "MakefileParser"` |
| Package/plugin version metadata only | Verify the six versioned manifests are aligned and valid JSON; no analysis test is needed solely for a version string. |
| Shared core APIs, parser registry, or graph schema | Core build and core test suite. |
| Roslyn provider, helper, graph conversion, or incremental fingerprints | `build:dotnet`, `check:dotnet`, and focused Roslyn/incremental tests. |

Run the full root suite only when changes span interacting workflows, focused tests indicate broader risk, a release/CI gate requires it, or the user requests it. This suite includes subprocess-heavy temporary-repository tests and can take several minutes; do not impose it automatically on a small import/parser fix.

When changes are cross-cutting or focused checks reveal wider impact, use the normal fork gates as applicable:

```text
npx --yes pnpm@10.6.2 build:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core build
npx --yes pnpm@10.6.2 check:dotnet
npx --yes pnpm@10.6.2 --filter @understand-anything/core test
npx --yes pnpm@10.6.2 test
```

After all required checks pass, tag the exact tested code commit and add the changelog entry using `Verified Changelog and Rollback Tags` above. Commit only `CHANGELOG.md` as a separate changelog-recording commit on the approved sync branch before asking whether to promote to local `main`; this keeps the tag on the tested code commit. If unrelated working-tree changes are present, leave them untouched and ask before committing or promoting. The entry must distinguish passed checks from checks not run.

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
   Because the version bump changes the verified commit, create a new annotated verification tag and changelog entry for the final tested commit; preserve the earlier tag as a rollback point.
4. Use `vscode_askQuestions` for the final push choice: offer pushing the verified fork branch with its current verification tag or leaving the validated work local. Keep freeform input enabled for other instructions. Push branch and tag only after an explicit yes. Never force-push or retarget an existing tag.

If the user declines, leave the validated local result in place and report its branch/commit. Never publish application source, generated graphs, credentials, or user-local config.

## Completion Report

At each stop or completion, summarize what was fetched, what upstream changed, textual and behavioral risks, tests run and results, current branch/commit, and whether local promotion or push occurred. Distinguish a Git merge from verified Roslyn behavior. Always identify the next available step so the user can continue the workflow.