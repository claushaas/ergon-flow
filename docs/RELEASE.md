# Release Guide

## Versioning

All public packages are released together at the same version:

- `@ergon/shared`
- `@ergon/clients`
- `@ergon/storage`
- `@ergon/engine`
- `@ergon/cli`

Before tagging a release:

1. update the shared version in the workspace package manifests
2. update `CHANGELOG.md`
3. run the full gate locally

## Local Release Gate

Run:

```bash
pnpm biome
pnpm typecheck
pnpm build
pnpm test
pnpm pack:validate
pnpm smoke:cli
pnpm smoke:global-install
```

## Cutting a Release

The public release flow is tag-driven from `main`.

1. merge the release candidate to `main`
2. create and push a tag like `v0.1.1`
3. GitHub Actions validates the tag/version match and publishes packages in
   dependency order

## What the Publish Workflow Checks

The release workflow:

- verifies the tag version matches all workspace package versions
- verifies the tagged commit is on `main`
- runs the full gate
- validates packed tarballs
- publishes packages in dependency order

## Partial Publish Recovery

If the workflow fails after some packages are already published:

1. identify the highest package that was published successfully
2. fix the underlying issue on `main`
3. bump all workspace package versions to a new patch version
4. update `CHANGELOG.md`
5. create and push a new tag

Do not republish the same version after a partial publish.
