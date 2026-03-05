# STOA Monorepo

Monorepo for the STOA workflow CLI, agent runtime, workflow engine, storage layer,
and the template/schema library.

This is a scaffold with placeholders to accelerate implementation.

## Packages

- packages/runtime — minimal agent runtime
- packages/engine — workflow execution engine
- packages/cli — `stoa` CLI
- packages/storage — SQLite layer + migrations
- library/ — workflow templates, agents, and JSON schemas

## Quickstart

pnpm install
pnpm -r build
pnpm -r test
