# Verified Changelog

This changelog tracks known-good code commits as rollback anchors. Each tag points to the exact code commit recorded in its entry. Changelog-only commits may follow a tagged code commit. Keep entries newest first and preserve prior entries.

## 2026-10-30: Upstream sync

- Branch: `main`
- Verified commit: `57314b7f20877d48e55d655d1852a7a18c44f38d`
- Tag: `verified-main-2026-10-30-57314b7` (annotated, local)
- Summary: Merged upstream Python relative-import and Makefile assignment fixes; added isolated setup-profile support and path-proportional sync validation guidance.
- Verification on merged tree: Python resolver tests (6 passed), Makefile parser tests (4 passed), and `build:dotnet` passed.
- Additional validation on the sync branch: core suite (1,022 passed, 1 skipped); isolated full setup completed package builds, Roslyn publish, and smoke checks, then removed its temporary profile.
- Not run on the merged commit: full root Vitest suite. An earlier full-suite attempt was incomplete and is not counted as passing.
- Rollback reference: `git switch --detach verified-main-2026-10-30-57314b7` to inspect this exact code state; create a recovery branch from the tag before making changes.

## 2026-10-30: Verified baseline

- Branch: `main`
- Verified commit: `250f74404d64b3ba976bfd78b143d1f995e140d0`
- Tag: `verified-main-2026-10-30` (annotated, local)
- Verification: User-confirmed working baseline. Tests were not rerun as part of this changelog bootstrap.
- Summary: Recorded the current `main` baseline before future upstream syncs.
- Rollback reference: `git switch --detach verified-main-2026-10-30` to inspect this exact code state; create a recovery branch from the tag before making changes.
