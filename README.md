# Ergon Flow

Monorepo for the `ergon` workflow CLI, worker runtime, storage layer, shared
contracts, and the declarative workflow library.

## Packages

- `packages/cli` — `ergon` CLI entrypoint
- `packages/engine` — worker runtime, engine loop, and built-in step executors
- `packages/clients` — provider/client adapters
- `packages/storage` — SQLite bootstrap, migrations, and persistence APIs
- `packages/shared` — shared runtime contracts and enums
- `library/` — workflows, agents, and JSON schemas

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/main.js template list
```
