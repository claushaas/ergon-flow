---
name: release-version-bump
description: Prepare Ergon Flow for a coordinated version bump and release. Use when Codex needs to update the workspace from one release version to another, refresh changelog/docs/tests that assert the current version, run the local release gate, or prepare the repository for a new tag such as `v0.1.4`.
---

# Release Version Bump

Update all workspace package versions together, then fix the versioned surfaces that this repository keeps in docs, smoke scripts, and CLI tests.

Prefer minimal release diffs. Do not mix unrelated feature work into the same commit when preparing a version bump.

## Workflow

1. Identify the current version and target version.

2. Update all package manifests together:
- `package.json`
- `packages/cli/package.json`
- `packages/clients/package.json`
- `packages/engine/package.json`
- `packages/shared/package.json`
- `packages/storage/package.json`

3. Add a new top entry to `CHANGELOG.md` for the target version and current date.

4. Search for the old version string and update repository surfaces that describe the current release. In this repo, check at least:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/RELEASE.md`
- `docs/ROADMAP.md`
- `docs/SPEC.md`
- `docs/TEMPLATE_SPEC.md`
- `scripts/smoke-global-install.mjs`
- `packages/cli/tests/core-commands.test.ts`
- `packages/cli/tests/help.test.ts`

5. Run the release gate in sequence:

```bash
pnpm biome
pnpm typecheck
pnpm build
pnpm test
pnpm pack:validate
pnpm smoke:cli
pnpm smoke:global-install
```

6. If the gate passes, summarize:
- target version
- files updated
- commands run
- whether the repo is ready for tag creation

## Search Pattern

Use `rg` first to find stale references before editing:

```bash
rg -n '0\\.1\\.3' package.json packages README.md docs CHANGELOG.md scripts -g '!**/dist/**'
```

Replace the version literal as needed for the current source version.

## Release Notes

Follow [docs/RELEASE.md](/Volumes/dev/repos/ergon-flow/docs/RELEASE.md) for the release contract:
- packages publish together
- tags are cut from `main`
- the publish workflow validates version/tag alignment

When asked for the final tag commands, use the versioned form:

```bash
git checkout main
git pull --ff-only
git merge --ff-only <release-branch>
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```
