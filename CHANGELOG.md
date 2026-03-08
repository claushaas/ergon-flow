# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [0.1.3] - 2026-03-08

### Added

- `on_failure` workflow hooks with best-effort `notify` execution after run
  failure
- `artifacts.failure.*` interpolation context for failure notifications
- `ergon run list` to inspect queued, running, failed and waiting runs
- project-local `.env` loading with configurable `env_file` in
  `./.ergon/config.json`
- a root `.env.example` for local provider configuration
- a repository-specific `code.bump_deps.ergon_flow` workflow template

### Changed

- `ergon run status <run_id>` is now the canonical status command
- CLI provider args now support quoted and escaped values in `*_ARGS`
- release smoke scripts now use the canonical `run status` command shape

## [0.1.2] - 2026-03-06

### Added

- Global CLI installation via `pnpm add -g @claushaas/ergon-cli`
- Explicit project bootstrap with `ergon init`
- Project-local `.ergon/library` resolution and `ergon library sync`
- Release tarball validation and global-install smoke checks
- Tag-based npm release workflow for public package publishing

### Changed

- Canonical docs now describe the public `v0.1.2` install and runtime model
- Public packages now ship npm metadata suitable for publication
- Public package names now use the explicit `@claushaas/ergon-*` convention
