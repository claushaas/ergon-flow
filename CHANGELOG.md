# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [0.1.1] - 2026-03-06

### Added

- Global CLI installation via `pnpm add -g @claushaas/cli`
- Explicit project bootstrap with `ergon init`
- Project-local `.ergon/library` resolution and `ergon library sync`
- Release tarball validation and global-install smoke checks
- Tag-based npm release workflow for public package publishing

### Changed

- Canonical docs now describe the public `v0.1.1` install and runtime model
- Public packages now ship npm metadata suitable for publication
