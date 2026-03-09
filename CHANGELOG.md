# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [0.2.2] - 2026-03-09

### Fixed

- CLI agent providers `codex`, `claude-code`, and `openclaw` now register with
  their default commands even when no explicit `*_COMMAND` override is present
- `ergon skill install` now replaces an existing installed skill in place so
  bundled skill updates can be reapplied cleanly

## [0.2.1] - 2026-03-09

### Fixed

- `ergon skill install` now installs the bundled CLI skill by default, so it
  works in third-party repositories without requiring a local `skill/`
  directory
- skill installation source validation now rejects symbolic links in the skill
  tree before copying files
- stdout notifications now strip ANSI escape sequences and unsafe control
  characters before logging
- storage step kind types now align with the shared runtime contract, removing
  the cast in the engine and centralizing failure-code mapping

## [0.2.0] - 2026-03-08

### Added

- `delay` as a native workflow step kind for controlled pauses between steps
- `ergon skill install` for copying repo-distributed skills into a local skills
  directory
- detached library mode with `ergon init --no-library`,
  `ergon library sync --detach`, and `ergon library sync --reattach`
- a repo-distributed `ergon-flow-expert` skill for CLI and workflow authoring

### Changed

- `codex` and `claude-code` providers now default to non-interactive CLI modes
- canonical docs now describe workflow reuse via inputs, manual rejection
  semantics, update flows, and detached library behavior
- future-facing agent profiles and artifact schemas now live under
  `docs/ideas/`

## [0.1.4] - 2026-03-08

### Added

- `agent.smoke`, a minimal workflow to validate agent, notify and exec steps
  without changing repository dependencies

### Changed

- worker cleanup now stops heartbeat and lease renewal loops cleanly after a
  run terminates
- release docs and CLI smoke assertions now track `v0.1.4`

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
