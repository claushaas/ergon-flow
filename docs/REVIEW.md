# 1. Veredito executivo

Estado geral: o repositório **não está pronto** para `v0.0.1`.

Há partes sólidas no nível baixo, principalmente bootstrap SQLite, claim atômico e alocação monotônica de `events.seq`. Mas isso é insuficiente. Os blockers reais estão no nível de determinismo e prontidão operacional: **template drift silencioso**, **worker stale ainda conseguindo mutar estado após lease reclaim/cancel**, **workflows reais da biblioteca quebrados semanticamente**, e **artefatos de release/CLI não executáveis**.

A implementação **não está aderente ao roadmap atual** nem **alinhada à documentação arquitetural** em pontos centrais. O conjunto atual parece uma base técnica promissora, mas chamar isso de “fase final / v0.0.1 pronta” seria enganoso.

# 2. Matriz de aderência docs ↔ código

| Área | Requisito | Status | Evidência | Observação |
|---|---|---|---|---|
| Roadmap A1 | Packages e boundaries | DIVERGENTE | [defaults.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/defaults.ts#L1), [packages/executors/src/index.ts](/Volumes/dev/repos/ergon-flow/packages/executors/src/index.ts#L1), [engine/index.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/index.ts#L13) | `engine` embute executors, importa `clients/src` por path relativo e o package `@claushaas/executors` está vazio. |
| Roadmap A2 | Shared contracts | OK | [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L1) | Tipos, enums e error codes canônicos existem. |
| Roadmap A3 | Layout `.runs/<run_id>/...` e path safety | PARCIAL | [paths.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/paths.ts#L1), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) | Helpers existem, mas o runner ignora `steps/<step_id>/<attempt>/` e grava tudo em `artifacts/`, quebrando rastreabilidade por tentativa. |
| Roadmap B1 | SQLite bootstrap, pragmas, migrations | OK | [db.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/db.ts#L24), [0001_init.sql](/Volumes/dev/repos/ergon-flow/packages/storage/src/migrations/0001_init.sql), [0002_indexes.sql](/Volumes/dev/repos/ergon-flow/packages/storage/src/migrations/0002_indexes.sql) | Pragmas, migrations e índices básicos existem. |
| Roadmap B2 | Storage API mínima | PARCIAL | [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L148), [workflows.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/workflows.ts#L42) | API existe, mas não implementa `workflow_scheduled`, não materializa defaults de inputs e não protege a imutabilidade `workflow_hash`. |
| Roadmap B3 | Claim/lease primitives | PARCIAL | [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L382), [claim-lease.test.ts](/Volumes/dev/repos/ergon-flow/packages/storage/tests/claim-lease.test.ts) | O claim é atômico em SQLite, mas a exclusão mútua termina aí: worker stale ainda pode escrever depois do reclaim. |
| Roadmap C1/C2 | Loader, normalização e validação de templates | PARCIAL | [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L238), [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L450) | Loader existe, mas aceita ausência de `inputs/outputs`, descarta steps malformados silenciosamente e não valida semântica cross-step. |
| Roadmap C3 | Interpolação mínima | PARCIAL | [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L623), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L582) | `inputs.*` e `artifacts.*` funcionam, mas defaults não são resolvidos, `outputs: artifacts.foo` não funciona e vários campos de template não são interpolados. |
| Roadmap D1 | Client registry | PARCIAL | [clients/index.ts](/Volumes/dev/repos/ergon-flow/packages/clients/src/index.ts#L560) | Registry existe, mas o conjunto de providers aceito pelo parser é maior que o conjunto realmente instanciável. |
| Roadmap D2/D3 | Adapters suportados | PARCIAL | [clients/index.ts](/Volumes/dev/repos/ergon-flow/packages/clients/src/index.ts#L536), [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L16) | `openrouter/ollama/codex/claude-code/openclaw` existem, mas `openai/anthropic` são aceitos e não têm client; `openclaw agent:` do spec não é usado. |
| Roadmap E | Framework de executores | OK | [executors/index.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/index.ts#L1) | Interface e registry existem. |
| Roadmap E2-E7 | `agent`, `exec`, `condition`, `manual`, `notify`, `artifact` | PARCIAL | [agent.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/agent.ts#L15), [exec.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/exec.ts#L127), [manual.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/manual.ts#L7), [notify.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/notify.ts#L294) | Todos existem, mas há bugs contratuais: naming inconsistente de artifacts, `manual.message` sem interpolação, `notify.channel` sem interpolação, `exec` sem timeout/cancel. |
| Roadmap F1 | Engine sequencial | PARCIAL | [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1244) | Loop sequencial existe, mas as transições de step/run não são transacionais e parte dos writes ignora perda de claim. |
| Roadmap F2 | Retry handling | PARCIAL | [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1030), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) | Retry por step existe, mas artifacts de attempts anteriores podem sobrescrever/contaminar o estado restaurado. |
| Roadmap F3 | Cancellation checks | PARCIAL | [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L821), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) | O cancel é observado antes e depois do step, não durante; step em voo ainda pode persistir `step_succeeded` e artifacts. |
| Roadmap G1/G2 | Worker runtime e crash recovery | PARCIAL | [worker.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/worker.ts#L307), [worker.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/worker.ts#L354) | Heartbeat, polling, renew e recovery existem, mas não há fencing contra o worker antigo continuar escrevendo após reclaim. |
| Roadmap H1-H3 | CLI core, approvals e cancel | PARCIAL | [main.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/main.ts#L13), [run.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/commands/run.ts#L64) | Funções existem, mas o binário compilado quebra e o entrypoint `src` também quebra em runtime. |
| Roadmap I | Notify final | PARCIAL | [notify.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/notify.ts#L306), [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L222) | `run.summary` existe para canais estáticos; os workflows reais usam `channel: "{{ inputs.notify.channel }}"` e falham. |
| SPEC §6-11 | Modelo assíncrono queue + worker; CLI só agenda | OK | [main.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/main.ts#L16), [worker.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/worker.ts#L349) | A separação scheduling/execution existe. |
| SPEC §7-9 | Lifecycle, determinismo, persistência de estado e eventos | PARCIAL | [events.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/events.ts#L25), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) | `events.seq` parece correto, mas o runtime de step/run não preserva invariantes sob cancel, reclaim e falhas no meio da persistência. |
| ARCHITECTURE §4-9 | CLI não executa steps; executors não gravam DB | OK | [main.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/main.ts#L13), [manual.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/manual.ts#L18) | Esses boundaries principais são respeitados. |
| ARCHITECTURE §8-15 | Storage centraliza persistência; integrações externas ficam em clients; worker stateless; leases impedem dupla execução | DIVERGENTE | [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184), [defaults.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/defaults.ts#L1), [notify.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/notify.ts#L294) | Engine grava filesystem diretamente; integrações externas de notify estão no executor; lease evita dupla claim, mas não dupla mutação após reclaim. |
| DB_SCHEMA §7 | Tabelas, pragmas, índices, seq por run | PARCIAL | [0001_init.sql](/Volumes/dev/repos/ergon-flow/packages/storage/src/migrations/0001_init.sql), [events.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/events.ts#L37) | A maior parte existe; `events.seq` é bom. Mas o documento e o schema divergem no PK de `workflows`, e `workflow_hash` não é invariado. |
| DB_SCHEMA §9-12 | Scheduling transacional com `workflow_scheduled`; `step_scheduled`; transações críticas; resume/retry/manual | DIVERGENTE | [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L148), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1083), [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L90) | Eventos `workflow_scheduled`/`step_scheduled` existem no enum e na doc, mas não são emitidos; start/finish de step não é transacional. |
| DB_SCHEMA §7.4 | `workflow_hash`/`version` como proteção contra drift | DIVERGENTE | [workflows.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/workflows.ts#L48), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1261) | O hash é armazenado no run, mas nunca verificado na execução; `registerWorkflow` pode sobrescrever hash e path no mesmo `id/version`. |
| TEMPLATE_SPEC §4-7 | Top-level shape, metadata, inputs, steps | PARCIAL | [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L238), [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L450) | O parser aceita muita coisa, mas `inputs`/`outputs` não são exigidos e defaults/required não são aplicados aos runs. |
| TEMPLATE_SPEC §9-19 | Providers, outputs, artifact refs, interpolation permitida, rejeição de refs inválidas | DIVERGENTE | [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L623), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L582), [clients/index.ts](/Volumes/dev/repos/ergon-flow/packages/clients/src/index.ts#L560) | A doc mostra `steps.*`, `outputs: artifacts.foo`, `openai/anthropic`, `openclaw agent:` e canais de notify que o runtime não suporta de fato. |
| Workflows reais | Funcionalidades prometidas existem de fato nos YAMLs da biblioteca | DIVERGENTE | [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L151), [code.codegen.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.codegen.yaml#L95), [code.hotfix.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.hotfix.yaml#L104) | Os YAMLs embutidos não batem com os contratos reais dos executores; vários quebram em runtime. |

# 3. Problemas críticos

- **Template drift silencioso invalida determinismo**
  Severidade: CRÍTICO. Impacto: um run já enfileirado ou recuperado pode executar um template diferente do que foi agendado.
  Evidência: [workflows.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/workflows.ts#L48) faz upsert de `hash` e `source_path` no mesmo `id/version`; [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1261) carrega workflow só por `id/version`; [run.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/commands/run.ts#L79) grava `workflow_hash` no run.
  Fato: o hash existe no banco, mas não participa da resolução do template em execução.
  Violação: quebra `DB_SCHEMA.md` e a promessa de replay/reprodutibilidade.
  Correção recomendada: tornar `workflows(id,version)` imutável, rejeitar hash drift, ou persistir snapshot do template por run e verificar `workflow_hash` antes de executar.

- **Lease reclaim e cancel não fazem fencing do worker antigo**
  Severidade: CRÍTICO. Impacto: após reclaim ou cancel, o worker antigo ainda pode gravar artifacts, marcar `step_succeeded` e emitir eventos conflitantes.
  Evidência: [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L452) e [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L476) protegem cursor/run final por `claimed_by`, mas [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) persiste artifacts e [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1192) atualiza `step_runs` sem checar ownership; [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1213) só olha cancel depois da persistência.
  Fato: writes de `step_runs`, `artifacts` e `events` não são fenceados pelo lease atual.
  Inferência: um worker stale após lease expiry pode concluir uma tentativa que já foi marcada failed pelo novo worker.
  Violação: risco real de dupla execução semântica, histórico contraditório e estado impossível.
  Correção recomendada: introduzir fence token/lease version em todas as mutações de step/run e encapsular transições de step em transações atômicas.

- **Artifacts por tentativa não são isolados; auditoria por retry fica corrompida**
  Severidade: CRÍTICO. Impacto: retries sobrescrevem o mesmo arquivo; rows antigas do DB passam a apontar para conteúdo novo; resume pode restaurar artifact de tentativa falha.
  Evidência: [paths.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/paths.ts#L95) define `stepAttemptDir`, mas [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184) grava só via `artifactPath`; [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L330) restaura todos os artifacts do run sem filtrar step bem-sucedido.
  Fato: o path em disco é por `run + artifact name`, não por `step_run`.
  Violação: quebra rastreabilidade por tentativa e consistência DB↔FS pedidas em `DB_SCHEMA.md`.
  Correção recomendada: persistir arquivos por `step_id/attempt`, guardar ponteiro por attempt e restaurar apenas artifacts de `step_runs` em `succeeded`.

- **Os workflows da biblioteca não são executáveis como estão**
  Severidade: CRÍTICO. Impacto: a release promete workflows prontos, mas os YAMLs embutidos quebram por contrato semântico incorreto.
  Evidência: [run.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/commands/run.ts#L42) só persiste inputs crus; [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L8) declara defaults que nunca são aplicados; [notify.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/notify.ts#L306) faz `switch(step.channel)` sem interpolar; [manual.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/manual.ts#L11) não interpola `message`; [agent.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/agent.ts#L15) renomeia `analyze -> analysis`; [exec.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/exec.ts#L181) produz `tests.exec.stdout|stderr|result`, mas os templates referenciam `artifacts.tests_exec`; [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L590) só resolve outputs com `{{ ... }}` exato.
  Fato: `code.refactor`, `code.codegen`, `code.hotfix`, `code.docs_update` e `code.bump_deps` têm referências incompatíveis com os executores.
  Violação: roadmap e docs vendem uma biblioteca funcional que não existe de fato.
  Correção recomendada: definir contrato único de naming/output, materializar defaults, interpolar todos os campos declarativos relevantes e validar semanticamente `library/workflows` em CI.

- **Os artefatos de release e a CLI não rodam**
  Severidade: CRÍTICO. Impacto: o usuário não consegue usar nem o entrypoint “dev” nem o binário compilado.
  Evidência: [defaults.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/defaults.ts#L1) importa `../../clients/src/index.js`; smoke real: `node packages/cli/dist/main.js template list` falha com `ERR_MODULE_NOT_FOUND`; smoke real: `node packages/cli/src/main.ts template list` falha resolvendo `./commands/approve.js`.
  Fato: CI verde não garante que o produto compilado inicia.
  Violação: blocker operacional para qualquer release.
  Correção recomendada: usar apenas imports de package (`@claushaas/ergon-clients`), corrigir o entrypoint de desenvolvimento e adicionar smoke test do binário em CI.

# 4. Problemas importantes não críticos

- **Eventos e transições críticas prometidos na documentação não existem ou não são transacionais**
  Severidade: ALTO. Impacto: trilha de auditoria incompleta e recuperação menos confiável.
  Evidência: [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L90) inclui `workflow_scheduled`/`step_scheduled`; [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L148) e [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1083) nunca os emitem.
  Fato: `createRun` não gera `workflow_scheduled`; step attempts começam em `step_started`.
  Correção recomendada: implementar os eventos faltantes e agrupar schedule/start/finish de step em transações.

- **O surface de providers diverge do runtime real**
  Severidade: ALTO. Impacto: templates válidos no parser podem falhar em runtime sem aviso prévio.
  Evidência: [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L16) aceita `openai` e `anthropic`; [clients/index.ts](/Volumes/dev/repos/ergon-flow/packages/clients/src/index.ts#L560) não cria clients para eles; `openclaw agent:` do spec não é propagado do step até o client.
  Fato: o parser aceita mais do que o worker consegue executar.
  Correção recomendada: ou implementar os providers faltantes, ou rejeitá-los já na validação/preflight.

- **`depends_on` não é dependência de execução real**
  Severidade: ALTO. Impacto: templates com dependência forward ou fora de ordem podem executar steps cedo demais.
  Evidência: [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L507) só valida existência/ciclo; [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L416) usa `depends_on` só para heurística de skip.
  Fato: se a dependência ainda não existe em `completedSteps`, o runner não bloqueia a execução.
  Correção recomendada: impor ordenação topológica ou restringir `depends_on` a steps anteriores.

- **Segredos e payloads sensíveis podem parar no banco**
  Severidade: ALTO. Impacto: `request_json`/`output_json` podem registrar env interpolado, prompts, responses brutas e URLs de webhook.
  Evidência: [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L340) grava `env`, `prompt`, `target`; [agent.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/agent.ts#L97) coloca `request` e `response` em `outputs`.
  Fato: não existe redaction.
  Violação: contraria a observação do `DB_SCHEMA.md` de excluir secrets de `request_json`.
  Correção recomendada: redigir/redactar campos sensíveis antes de persistir.

- **Boundaries arquiteturais e pacotes decorativos estão fora do lugar**
  Severidade: MÉDIO. Impacto: empacotamento frágil, acoplamento indevido e documentação enganosa.
  Evidência: [defaults.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/defaults.ts#L1), [packages/executors/src/index.ts](/Volumes/dev/repos/ergon-flow/packages/executors/src/index.ts#L1), [stateMachine/index.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/stateMachine/index.ts#L1).
  Fato: `packages/executors`, `stateMachine`, `artifacts` e scripts de build/test ainda têm TODO/placeholder enquanto o roadmap marca scopes como concluídos.
  Correção recomendada: remover placeholders da superfície pública ou terminá-los de fato.

# 5. Bugs concretos encontrados

- **Fato:** `outputs: artifacts.patch` vira a string literal `"artifacts.patch"`; o runtime só resolve output se o valor for `{{ artifacts.patch }}`. Evidência: [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L582), [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L239).
- **Fato:** `notify.channel: "{{ inputs.notify.channel }}"` nunca funciona; o executor faz `switch(step.channel)` sem interpolação. Evidência: [notify.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/notify.ts#L306), [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L222).
- **Fato:** mensagens de step manual ficam com placeholders crus; `manual.message` não é interpolado. Evidência: [manual.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/manual.ts#L11), [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L205).
- **Fato:** defaults de inputs nunca são aplicados aos runs. Evidência: [run.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/commands/run.ts#L42), [code.refactor.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.refactor.yaml#L8).
- **Fato:** vários templates referenciam `artifacts.tests_exec`, `artifacts.deps_scan` e `artifacts.analyze`, mas `exec` emite `step.id.stdout|stderr|result` e `analyze` vira `analysis`. Evidência: [exec.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/exec.ts#L181), [agent.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/executors/agent.ts#L15), [code.codegen.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.codegen.yaml#L171), [code.hotfix.yaml](/Volumes/dev/repos/ergon-flow/library/workflows/code.hotfix.yaml#L104).
- **Fato:** `workflow_scheduled` e `step_scheduled` são tipos declarados mas nunca emitidos. Evidência: [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L90), [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L148), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1083).
- **Fato:** `ergon` compilado não sobe; `dev` também não. Evidência: smoke `node packages/cli/dist/main.js template list` e `node packages/cli/src/main.ts template list`.
- **Fato:** parser aceita `openai`/`anthropic`, mas o registry default não cria client para eles. Evidência: [enums.ts](/Volumes/dev/repos/ergon-flow/packages/shared/src/enums.ts#L16), [clients/index.ts](/Volumes/dev/repos/ergon-flow/packages/clients/src/index.ts#L560).
- **Inferência forte:** após reclaim de lease, o worker antigo ainda pode marcar a mesma tentativa como succeeded e gravar artifacts/eventos. Evidência: [tasks.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/repo/tasks.ts#L382), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184).
- **Fato:** retry sobrescreve o mesmo arquivo de artifact; o DB mantém múltiplas rows apontando para um path único. Evidência: [paths.ts](/Volumes/dev/repos/ergon-flow/packages/storage/src/paths.ts#L95), [runner.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/runner.ts#L1184).

# 6. Lacunas entre implementação e documentação

- `ROADMAP.md` marca scopes amplos como concluídos, mas o código ainda contém TODOs públicos em [engine/index.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/index.ts#L13), [stateMachine/index.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/stateMachine/index.ts#L1) e [packages/executors/src/index.ts](/Volumes/dev/repos/ergon-flow/packages/executors/src/index.ts#L1).
- `ROADMAP.md`, `ARCHITECTURE.md` e testes do loader ainda falam em `/templates`, mas a CLI real usa `library/workflows`; o código também está dividido entre as duas convenções. Evidência: [templating.ts](/Volumes/dev/repos/ergon-flow/packages/engine/src/templating/index.ts#L275), [run.ts](/Volumes/dev/repos/ergon-flow/packages/cli/src/commands/run.ts#L32), [template-loader.test.ts](/Volumes/dev/repos/ergon-flow/packages/engine/tests/template-loader.test.ts#L75).
- `DB_SCHEMA.md` exige schedule transacional com `workflow_scheduled` e step lifecycle com `step_scheduled`; a implementação não faz isso.
- `DB_SCHEMA.md` trata `workflow_hash` como proteção contra drift; a implementação o armazena mas não o usa.
- `TEMPLATE_SPEC.md` exige `workflow/inputs/steps/outputs`; o validator aceita template sem `inputs/outputs`.
- `TEMPLATE_SPEC.md` mostra `outputs: patch: artifacts.patch`; o runtime não suporta essa sintaxe.
- `TEMPLATE_SPEC.md` mostra `{{ steps.analyze.output }}`; o interpolador rejeita qualquer fonte fora de `inputs.*` e `artifacts.*`.
- `TEMPLATE_SPEC.md` lista notify targets como `slack/discord/email/webhook`; o runtime só suporta `stdout/webhook/openclaw`.
- `ARCHITECTURE.md` diz que integrações externas ficam em clients e storage centraliza persistência; hoje `NotifyExecutor` fala com webhook/OpenClaw e o runner grava filesystem diretamente.
- `README.md` ainda descreve “STOA Monorepo”, `stoa` CLI e `packages/runtime`; a documentação de topo não representa o repositório atual.
- `library/agents` e `library/schemas` existem, mas o runtime não carrega profiles nem valida output de agent contra JSON Schema. Isso fere a promessa declarativa do próprio repositório.

# 7. Lacunas de testes

- Não há teste de **worker stale continuando a escrever depois de lease reclaim**.
- Não há teste de **cancelamento de step longo** com interrupção real de subprocesso.
- Não há teste de **falha no meio de `persistArtifacts`** deixando `step_run` consistente.
- Não há teste de **overwrite de artifact entre attempts** nem de restauração de artifacts de attempt falha.
- Não há teste executando **qualquer workflow real de `library/workflows/`** ponta a ponta.
- Não há teste de **materialização de defaults de inputs** ou validação de `required/type`.
- Não há teste de **`notify.channel` interpolado**, **`manual.message` interpolada** ou **outputs bare reference**.
- Não há teste cobrindo **providers aceitos mas sem client real** (`openai`, `anthropic`).
- Não há teste de **smoke do CLI binário compilado**; por isso a CI passa com um artefato quebrado.
- Não há teste concorrente real de **`events.seq` sob múltiplos appenders**; o código parece correto, mas a garantia não está provada operacionalmente.

# 8. Melhorias recomendadas antes de considerar “done”

- Introduzir um **fence token** por claim e mover step transitions para uma **state machine transacional**.
- Tornar a definição de workflow **imutável por version/hash** ou persistir snapshot por run.
- Definir um **contrato semântico de templates**: defaults resolvidos, referências de artifacts validadas, outputs consistentes e naming padronizado.
- Redesenhar persistência de artifacts para **attempt-local storage** e restauração apenas de attempts bem-sucedidas.
- Adicionar **smoke tests do binário**, **end-to-end com workflows reais**, e **preflight/doctor** para providers/configuração.
- Redactar segredos de `request_json/output_json`.
- Fechar ou remover placeholders públicos e alinhar docs topo/arquitetura/roadmap com o que realmente existe.

# 9. Patch plan recomendado

- **P0 bloqueantes**
  - Corrigir imports cruzados por `src` e fazer `ergon` compilado/subida de desenvolvimento funcionar.
  - Tornar `workflow_hash/version` efetivamente imutáveis na execução.
  - Fencear todas as mutações de step/run/artifact/event pelo claim atual e transacionar step start/finish.
  - Consertar o contrato de template/runtime: defaults de inputs, `notify.channel`, `manual.message`, outputs e naming de artifacts.
  - Validar semanticamente `library/workflows` em CI e ajustar os YAMLs para o contrato real.

- **P1 importantes**
  - Persistir artifacts por attempt em `steps/<step_id>/<attempt>/`.
  - Implementar `workflow_scheduled` e `step_scheduled`.
  - Fechar mismatch de providers: ou suportar `openai/anthropic/openclaw agent`, ou rejeitar cedo.
  - Adicionar timeout/AbortSignal para `exec` e clients remotos/CLI.
  - Redigir segredos antes de persistir request/response/output.

- **P2 desejáveis**
  - Remover/terminar `stateMachine`, `packages/executors`, `artifacts` e comandos `doctor/task`.
  - Unificar definitivamente `library/workflows` vs `/templates`.
  - Atualizar README, roadmap, architecture e template spec para refletirem o produto real.

# 10. Conclusão final

- **A implementação está aderente ao roadmap?** Não. Ela cobre parte significativa do esqueleto técnico, mas vários itens marcados como concluídos estão só parciais ou divergentes, e os workflows reais não sustentam a claim de “done”.
- **A implementação está aderente à documentação?** Não. Há divergências centrais em determinismo, template contracts, eventos, boundaries, layout e surface operacional.
- **O repositório está realmente pronto para a fase final / v0.0.1?** Não.
- **Quais são os blockers reais?**
  - Template drift silencioso por `id/version` mutável e hash não verificado.
  - Falta de fencing/transações que permitam writes após reclaim/cancel.
  - Workflows reais da biblioteca quebrados por contrato semântico incompatível com os executores.
  - CLI/binário compilado e entrypoint de desenvolvimento não executáveis.
  - Persistência de artifacts sem isolamento por attempt, comprometendo replay e auditoria.
  
---
  
# Roadmap de Correção para Levar o Repositório a Teste Prático

Este roadmap complementa a revisão e organiza a correção em fases fechadas.
A ordem é intencional: primeiro o que impede o produto de rodar, depois o que
quebra determinismo, depois o contrato do template, depois recovery e
cancelamento, e só então consolidação de testes e documentação.

O objetivo final é simples: deixar o repositório em um estado em que um usuário
consiga rodar o produto na prática, executar workflows reais, inspecionar runs
e confiar que o estado persistido não foi corrompido por reclaim, retry,
cancelamento ou drift de template.

## Regra de execução das fases

1. Cada fase deve fechar código, testes e documentação do contrato que ela
   muda.
2. Não abrir a fase seguinte com o binário quebrado ou com invariantes ainda
   indefinidos na fase anterior.
3. O critério de progresso não é "compila"; é "o comportamento prometido ficou
   correto e testado".

## Fase 1 — P0 Release e Boundaries

### Objetivo

Corrigir o que hoje impede o produto de rodar e limpar as fronteiras falsas do
monorepo. Esta fase existe para transformar o repositório em um artefato
executável de verdade antes de mexer nas invariantes do runtime.

### Problemas cobertos por esta fase

- O binário compilado `ergon` não sobe porque `@claushaas/ergon-engine` importa
  `packages/clients/src` por caminho relativo em vez de depender do package
  publicado.
- O entrypoint de desenvolvimento também não sobe como produto consumível.
- `packages/executors` existe no roadmap e no workspace, mas está vazio e a
  implementação real mora em `packages/engine/src/executors`.
- Há placeholders públicos que fazem o repositório parecer mais pronto do que
  está: `runWorkflow`, `stateMachine`, `artifacts`, `task`, `doctor` e scripts
  raiz de build/test.
- A convenção de templates está dividida entre `/templates` e
  `library/workflows`, o que fragmenta runtime, testes e documentação.
- `README.md` ainda descreve o monorepo como `STOA`, fala em `stoa` CLI e cita
  packages que não representam o produto atual.
- A arquitetura declarada em `ARCHITECTURE.md` fala em boundaries que o código
  hoje viola ou deixa ambíguos.

### Correções detalhadas

1. Corrigir todos os imports cruzando para `src`.
   Escolha um único contrato de package interno e aplique em todo o monorepo.
   `@claushaas/ergon-engine` deve importar `@claushaas/ergon-clients`, não
   `../../clients/src/index.js`. O mesmo vale para qualquer outro acoplamento
   por caminho físico que faça o build passar mas quebre o artefato em `dist`.

2. Consertar os entrypoints reais do produto.
   O binário declarado em `packages/cli/package.json` precisa ser testável após
   `pnpm build`. O modo de desenvolvimento também precisa refletir uma forma
   real de execução, não um atalho que só funciona em ambiente especial. A CI
   precisa incluir smoke do binário compilado e, se houver modo dev suportado,
   smoke explícito dele também.

3. Fechar a superfície pública do monorepo.
   Se `packages/executors` for parte do desenho, implemente-o e mova os
   executors para lá. Se não for, remova-o do desenho de release e dos docs.
   O mesmo vale para `runWorkflow`, `stateMachine`, `artifacts`, `task`,
   `doctor`, scripts placeholder e qualquer export público que não represente
   comportamento real.

4. Unificar o local oficial dos workflows.
   Para este repositório, o candidato correto é `library/workflows`, porque já
   é o diretório usado pela CLI e está alinhado com `AGENTS.md`. O loader,
   os testes, os docs e a CI devem convergir para esse local. Se existir fase
   de compatibilidade com `/templates`, ela deve ser temporária, explícita e
   não pode continuar na documentação canônica.

5. Corrigir boundaries arquiteturais logo no começo.
   O runtime precisa ter uma divisão clara entre CLI, engine, clients, storage
   e executors. A implementação de notify hoje também mistura integração externa
   dentro de executor. Nesta fase, decida se o backend de notificação ficará em
   `clients` ou em um adapter dedicado. O importante é não deixar a fronteira
   indefinida.

6. Atualizar a superfície de release do repositório.
   `package.json`, scripts por package, `README.md` e qualquer documentação de
   topo precisam representar o produto que realmente sobe: `ergon`, não `stoa`.
   O roadmap não deve continuar marcando como concluído um package vazio ou um
   módulo TODO exposto publicamente.

### Critério de saída

- `pnpm build` gera artefatos executáveis.
- O binário compilado `ergon` sobe e responde aos comandos básicos.
- Não há import relativo para `src` entre packages publicados.
- `library/workflows` é o único local canônico de templates em runtime e docs.
- Nenhum placeholder continua exposto como feature concluída.

### Referências

- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/SPEC.md`
- `README.md`
- `AGENTS.md`

## Fase 2 — P0 Determinismo e Segurança de Execução

### Objetivo

Fechar as invariantes que fazem o runtime ser confiável sob reclaim, retry,
cancelamento e falha parcial. Esta é a fase que transforma a base atual em um
runtime determinístico de verdade.

### Problemas cobertos por esta fase

- `workflow_hash` é gravado na schedule, mas ignorado na execução.
- `registerWorkflow` permite drift silencioso de `hash` e `source_path` para o
  mesmo `id/version`.
- O claim da run é atômico em SQLite, mas isso não impede um worker stale de
  continuar gravando `step_runs`, `artifacts` e `events`.
- Cancelamento e reclaim não fazem fencing das mutações subsequentes.
- As transições de step start/finish não são agrupadas em transações críticas.
- `workflow_scheduled` e `step_scheduled` são prometidos nos docs e no enum,
  mas não existem no comportamento real.
- O modelo atual permite histórico contraditório entre `workflow_runs`,
  `step_runs`, `events` e filesystem.

### Correções detalhadas

1. Tornar a identidade do workflow imutável para uma run.
   A execução não pode depender apenas de `workflow_id + workflow_version`. A
   solução mais segura é uma destas duas, escolhida de forma explícita:
   persistir um snapshot imutável do template por run, ou adicionar uma
   invariante forte que rejeite qualquer drift de `workflow_hash` para um mesmo
   `id/version`. O runtime precisa verificar essa identidade antes de iniciar ou
   retomar a execução.

2. Introduzir fencing por claim.
   O worker precisa carregar um token de claim monotônico, por exemplo
   `claim_epoch`, incrementado a cada claim ou reclaim. Toda mutação relevante
   durante a execução deve exigir o par correto:
   `run_id + worker_id + claim_epoch`. Sem isso, qualquer worker antigo ainda
   consegue finalizar step, gravar artifact e emitir evento depois de perder a
   lease.

3. Mover as transições críticas para APIs de storage com ownership explícito.
   Hoje o engine chama operações de persistência soltas. O correto é ter
   primitivas de storage para:
   schedule da run, start de step, finish de step, pause manual, fail terminal,
   cancel terminal e recovery de reclaim. Essas primitivas devem validar claim
   ownership e executar a mudança de estado de forma transacional.

4. Implementar os eventos de lifecycle faltantes.
   `workflow_scheduled` precisa nascer junto com a run, no mesmo contexto
   transacional da schedule. `step_scheduled` precisa existir antes de
   `step_started`. Isso fecha a trilha de auditoria prometida em `DB_SCHEMA.md`
   e melhora replay, debug e recovery.

5. Tornar step start/finish atomicamente consistentes.
   O ciclo "criar step_run -> marcar running -> executar -> persistir outputs ->
   emitir eventos -> avançar cursor" precisa ser reestruturado para não deixar
   estados parcialmente persistidos. O objetivo é impedir casos como:
   artifact gravado sem metadata, step marcado `succeeded` sem persistência
   completa, ou run avançando cursor com step incompleto.

6. Fechar as corridas entre reclaim, cancelamento e conclusão de step.
   O worker deve validar ownership antes de persistir o resultado de um step e
   imediatamente após o retorno do executor. Se a lease foi perdida ou a run foi
   cancelada, o resultado não pode mais ser commitado como sucesso daquela
   claim.

7. Preservar o que já está correto em `events.seq`.
   A alocação monotônica por run em `appendEvent` hoje está razoável. Não
   reescreva isso sem necessidade. O foco aqui é garantir que os eventos certos
   sejam emitidos e que a consistência deles com o resto do estado passe a ser
   protegida pelas transações e pelo fencing.

### Critério de saída

- Uma run nunca executa template divergente do que foi agendado.
- Um worker stale não consegue mais mutar estado depois de perder a lease.
- Cancelamento e reclaim não produzem histórico contraditório.
- `workflow_scheduled` e `step_scheduled` passam a existir de fato.
- As transições principais de step/run ficam consistentes sob falha e retry.

### Referências

- `docs/DB_SCHEMA.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

## Fase 3 — P0 Contrato de Template

### Objetivo

Escolher o contrato real do template e fazer runtime, workflows da biblioteca,
validator e documentação convergirem para ele. Esta fase fecha a fonte mais
perigosa de divergência semântica do repositório.

### Problemas cobertos por esta fase

- Defaults de `inputs` existem no YAML, mas nunca são materializados na run.
- `required` e os tipos primitivos de `inputs` não são aplicados na schedule.
- `outputs` em sintaxe bare reference como `artifacts.patch` não funcionam.
- A documentação mostra `{{ steps.analyze.output }}`, mas o runtime só aceita
  `inputs.*` e `artifacts.*`.
- `manual.message` não é interpolada.
- `notify.channel` não é interpolado, o que quebra os workflows reais.
- O naming de artifacts é inconsistente:
  `analyze -> analysis` por magia, `exec` produz nomes diferentes do que os
  YAMLs referenciam e workflows reais dependem disso de forma inválida.
- O parser aceita providers que o runtime não sabe instanciar de verdade.
- `depends_on` existe, mas hoje é usado mais como heurística de skip do que como
  dependência de execução real.
- `library/agents` e `library/schemas` existem como contratos declarativos, mas
  o runtime não os usa nem os valida.

### Correções detalhadas

1. Materializar inputs resolvidos na schedule.
   A schedule da run deve carregar o template, aplicar `default`, validar
   `required` e checar o tipo primitivo declarado antes de persistir
   `inputs_json`. O worker deve receber inputs já resolvidos e estáveis. Isso
   elimina a execução implícita dependente do YAML atual e reduz drift
   semântico.

2. Definir o shape obrigatório do template.
   Para `v0.0.1`, a recomendação é manter `workflow`, `inputs`, `steps` e
   `outputs` como shape canônico. `inputs` e `outputs` podem ser mapas vazios,
   mas devem existir explicitamente se a documentação continuar dizendo que são
   parte do contrato top-level.

3. Fechar a sintaxe oficial de outputs.
   A forma mais pragmática para estabilizar o repositório é suportar:
   bare references `inputs.foo` e `artifacts.foo`,
   e strings interpoladas com `{{ ... }}` quando necessário.
   Se preferir manter apenas `{{ ... }}`, então todos os workflows da biblioteca
   precisam ser migrados e o `TEMPLATE_SPEC.md` deve ser corrigido no mesmo PR.

4. Definir e documentar o contrato de interpolation.
   Para `v0.0.1`, o caminho seguro é manter apenas `inputs.*` e `artifacts.*`
   como fontes suportadas e rejeitar qualquer outra em validação estática.
   `steps.*` só deve permanecer nos docs se for realmente implementado; caso
   contrário, deve ser removido da documentação canônica.

5. Interpolar todos os campos declarativos que o runtime usa de fato.
   Isso inclui pelo menos `manual.message`, `notify.channel`, `notify.target`,
   `notify.message`, e qualquer outro campo cujo valor hoje seja lido cru do
   YAML e afete a execução. A regra precisa ser explícita no spec.

6. Eliminar naming mágico de artifacts.
   O runtime precisa parar de depender de convenções implícitas como
   `analyze -> analysis`. A solução recomendada é explicitar o nome do artifact
   produzido por cada step que alimenta outro step.
   Para `agent`, isso pode ser obrigatório via `output.name`.
   Para `exec`, é preciso introduzir um contrato explícito para `result`,
   `stdout` e `stderr`, em vez de supor nomes derivados do `step.id`.

7. Ajustar todos os workflows de `library/workflows` ao contrato escolhido.
   Nenhum workflow embutido pode depender de placeholder não interpolado,
   artifact inexistente, output mal resolvido ou provider que o runtime não
   suporta. Os YAMLs da biblioteca devem virar fixtures de verdade do produto,
   não apenas exemplos aspiracionais.

8. Fechar o surface de providers, channels e agent profiles.
   `openai` e `anthropic` só podem continuar no enum se houver client real ou
   se a validação bloquear o uso em tempo de template.
   O campo `agent:` de `openclaw` precisa ser implementado ou rejeitado
   explicitamente.
   `library/agents` e `library/schemas` precisam seguir uma das duas linhas:
   integrar ao runtime com validação real de outputs, ou sair do escopo
   canônico de `v0.0.1` e ser removido das claims da documentação.

9. Tornar `depends_on` semanticamente correto.
   O runtime deve garantir dependência de execução real, não apenas decidir
   `skip` quando uma dependência já falhou. A solução mais segura é restringir
   `depends_on` a referências anteriores e validar ordenação topológica no
   template.

### Critério de saída

- Inputs resolvidos e validados antes da execução.
- Workflows da biblioteca carregam, validam e executam contra o contrato real.
- Não há mais naming mágico escondido entre step e artifact.
- Providers e channels aceitos pelo validator são exatamente os que o runtime
  consegue executar.
- Template spec, validator e YAMLs da biblioteca passam a dizer a mesma coisa.

### Referências

- `docs/TEMPLATE_SPEC.md`
- `docs/ROADMAP.md`
- `docs/SPEC.md`
- `library/workflows/`
- `library/agents/`
- `library/schemas/`

## Fase 4 — P1 Artifacts, Recovery e Cancelamento

### Objetivo

Corrigir a parte operacional do runtime: persistência por tentativa, recovery
determinístico, resume correto, cancelamento real e proteção contra
contaminação entre attempts.

### Problemas cobertos por esta fase

- Artifacts de attempts diferentes compartilham o mesmo path em disco.
- Rows antigas do banco podem apontar para conteúdo sobrescrito por retry.
- O restore atual lê artifacts do run inteiro sem filtrar status ou attempt.
- Uma falha no meio da persistência do artifact pode deixar filesystem e banco
  divergentes.
- `exec` não tem timeout nem cancelamento cooperativo real.
- Integrações externas longas também não recebem cancelamento/abort consistente.
- Recovery de reclaim e retry ainda podem contaminar estado do próximo attempt.
- Cancelamento durante step em execução é tratado só depois do retorno do step.

### Correções detalhadas

1. Migrar artifacts para storage por attempt.
   O layout previsto em `DB_SCHEMA.md` e `paths.ts` já aponta na direção certa:
   `.runs/<run_id>/steps/<step_id>/<attempt>/...`.
   O runtime deve gravar o payload da attempt nesse espaço e registrar no banco
   paths específicos por `step_run_id`. O diretório `artifacts/` pode ficar
   reservado para outputs finais ou links estáveis, mas não pode mais ser o
   armazenamento primário de tentativas.

2. Restaurar apenas artifacts válidos para resume.
   O restore do run deve considerar somente attempts em estado `succeeded` e, em
   caso de múltiplas tentativas do mesmo step, apenas a última attempt válida.
   Artifacts de attempts falhas, canceladas ou sobrescritas não podem alimentar
   steps seguintes.

3. Tornar persistência de artifact resiliente a falha parcial.
   O write deve usar arquivo temporário, checksum, rename atômico e só depois
   inserir metadata e finalizar o step. Se a metadata falhar, o arquivo precisa
   ser limpo ou marcado para reconciliação. Se o write falhar, o step não pode
   virar `succeeded`.

4. Revisar o fluxo de retry.
   Retry deve abrir nova attempt sem reaproveitar arquivo anterior e sem deixar
   o estado restaurado enxergar resultados da attempt falha. O histórico no DB e
   no filesystem precisa ficar auditável por `step_run_id`.

5. Implementar cancelamento real para `exec`.
   `ExecExecutor` precisa receber `AbortSignal` ou mecanismo equivalente, aplicar
   timeout configurável, matar o processo filho com limpeza explícita e devolver
   status compatível com o novo modelo de transição fenceado.

6. Propagar timeout e cancelamento para clients e integrações externas.
   O mesmo princípio vale para requests HTTP e clients CLI. O worker precisa
   conseguir interromper um step que perdeu lease ou cujo run foi cancelado,
   sem esperar indefinidamente o retorno natural da integração.

7. Revisar resume semantics de ponta a ponta.
   Depois que artifacts por attempt existirem, o resume deve ser reavaliado:
   cursor da run, status de `step_runs`, artifacts restaurados, reclaim de lease
   expirada e retomada após manual approval precisam convergir para a mesma
   lógica de execução.

8. Revisar consistência entre pause manual, cancelamento e retomada.
   A aprovação manual, rejeição manual e cancelamento em `waiting_manual`
   precisam continuar corretos depois da mudança de fencing e artifacts por
   attempt. O ponto crítico aqui é impedir duplicação de evento, de attempt e de
   resume.

9. Redactar dados sensíveis antes de persistir.
   `request_json`, `response_json`, env interpolado, prompt bruto, target de
   webhook e payloads similares precisam de política de redaction. Essa correção
   entra aqui porque acompanha a revisão da persistência operacional e das
   integrações externas.

### Critério de saída

- Retry não sobrescreve nem contamina attempt anterior.
- Resume usa apenas artifacts válidos.
- Cancelamento de `exec` e integrações externas é real, não apenas observado
  depois do retorno.
- Failover por reclaim não deixa lixo ou artefato órfão relevante.
- Persistência de artifact e metadata fica reconciliável e auditável.

### Referências

- `docs/DB_SCHEMA.md`
- `docs/ARCHITECTURE.md`
- `docs/SPEC.md`
- `packages/storage/src/paths.ts`

## Fase 5 — P1/P2 Testes e Documentação

### Objetivo

Consolidar o estado final do repositório e impedir regressão. Nesta fase, a
documentação deixa de ser aspiracional e volta a ser uma fonte de verdade
confiável para o usuário que vai testar o produto.

### Problemas cobertos por esta fase

- A suíte atual é boa para unidade, mas não prova vários cenários críticos.
- A CI não detecta que o binário compilado está quebrado.
- Não existem E2E reais com `library/workflows`.
- Falta cobertura para reclaim concorrente, cancelamento de processo longo,
  drift de template, artifacts por retry e falha parcial de persistência.
- A documentação canônica ainda está em `Draft`/`TODO` e diverge do código.
- `README.md` está desatualizado.
- `ROADMAP.md` marca como concluído o que ainda está parcial ou divergente.

### Correções detalhadas

1. Adicionar smoke tests de release.
   A CI precisa subir o binário compilado `ergon`, rodar pelo menos
   `template list`, `workflow list` e um cenário mínimo de `run` + `worker`.
   Esse teste existe para impedir regressão de packaging e import boundary.

2. Adicionar E2E com workflows reais da biblioteca.
   Cada workflow de `library/workflows` deve ter ao menos um cenário de teste
   com clients stubados, worker real e inspeção de artifacts, events e status
   final. Isso transforma os YAMLs em contratos vivos do produto.

3. Cobrir reclaim, cancelamento e concorrência.
   A suíte precisa de cenários explícitos para:
   worker stale tentando escrever após reclaim,
   cancelamento durante processo longo,
   cancelamento durante request externa,
   approve/reject manual concorrente com cancel,
   e alocação concorrente de `events.seq`.

4. Cobrir persistência e recovery.
   Adicionar testes para:
   falha no meio de `persistArtifacts`,
   overwrite entre attempts,
   restore de attempts antigas,
   drift de workflow hash,
   mismatch entre metadata de artifact e arquivo em disco.

5. Cobrir o contrato de template de ponta a ponta.
   Adicionar testes para:
   defaults de input,
   tipos e `required`,
   `notify.channel` interpolado,
   `manual.message` interpolada,
   outputs bare reference,
   validação de providers suportados,
   rejeição de `steps.*` se permanecer fora do contrato.

6. Atualizar a documentação canônica.
   Depois que o código estiver estabilizado, `ROADMAP.md`, `SPEC.md`,
   `ARCHITECTURE.md`, `DB_SCHEMA.md`, `TEMPLATE_SPEC.md` e `README.md` precisam
   ser reescritos para refletir exatamente a implementação final. Onde a decisão
   for deliberadamente pragmática, isso deve aparecer explicitamente no texto.

7. Revisar o roadmap e a comunicação de release.
   O roadmap deve sair do estado atual de "✅" inflado e passar a refletir o que
   realmente ficou pronto. Se `library/agents` e `library/schemas` não entrarem
   no runtime final de `v0.0.1`, isso deve ser dito de forma direta.

### Critério de saída

- A CI consegue detectar quebra de release, quebra de template e quebra de
  invariantes do runtime.
- Os workflows reais da biblioteca têm cobertura E2E.
- Os documentos canônicos deixam de divergir entre si e do código.
- O repositório fica pronto para ser entregue a um usuário para teste prático
  sem depender de explicação verbal paralela.

### Referências

- `docs/ROADMAP.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/TEMPLATE_SPEC.md`
- `README.md`

## Resultado esperado ao final das cinco fases

Ao final desse roadmap, o repositório deve estar em um estado onde:

- o binário `ergon` sobe e executa fluxos reais;
- a lease impede não só dupla claim, mas também dupla mutação de estado;
- a identidade do template executado é estável e auditável;
- artifacts, events, step runs e workflow runs convergem para o mesmo histórico;
- os workflows embutidos em `library/workflows` são executáveis de verdade;
- a documentação deixa de prometer features implícitas ou placeholders;
- o usuário consegue testar o produto na prática sem tropeçar em armadilhas de
  packaging, contrato ou recovery.
