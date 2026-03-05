# Ergon Flow — Agents and Skills Guide

Version: 0.1
Status: Active

---

## 1. Overview

An **agent** in Ergon Flow is an intelligent execution unit capable of reasoning, planning, or generating outputs.

Agents are abstractions that can be implemented through:

- **Language Models** — Direct LLM API calls (OpenRouter, Ollama, OpenAI, Anthropic)
- **Coding Agents** — External agent systems (Claude Code, Codex CLI, OpenClaw)
- **Custom Runtimes** — Purpose-built execution environments

---

## 2. Agent Architecture

### Agent Definitions

Agents are defined declaratively in YAML format within the `library/agents/` directory.

```
library/agents/
├── coder.yaml
├── repo-analyzer.yaml
├── repo-planner.yaml
└── pr-writer.yaml
```

Example agent definition:

```yaml
id: code-analyst
description: Analyzes source code for quality and patterns
model: anthropic/claude-opus
capabilities:
  - code_analysis
  - pattern_detection
  - refactoring_suggestions
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique agent identifier |
| `description` | No | Human-readable description |
| `model` | No | Model identifier (format: `provider/model-name`) |
| `capabilities` | No | List of capabilities the agent provides |
| `config` | No | Provider-specific configuration |

---

## 3. Available Agents

### Coder (`coder`)

Generates and modifies source code.

- **Purpose**: Code generation, refactoring, bug fixes
- **Input**: Code context, requirements, or specification
- **Output**: Code patches, new files, refactored modules
- **Typical Providers**: Claude Code, Codex, DeepSeek

### Repo Analyzer (`repo-analyzer`)

Analyzes repository structure, dependencies, and health.

- **Purpose**: Repository assessment, architecture review, dependency analysis
- **Input**: Repository path, analysis scope
- **Output**: Analysis report, recommendations, metrics
- **Typical Providers**: DeepSeek, Anthropic, Kimi

### Repo Planner (`repo-planner`)

Plans multi-step development tasks.

- **Purpose**: Task planning, architecture planning, refactor planning
- **Input**: Requirements, constraints, current state
- **Output**: Detailed execution plan, step breakdown, risk assessment
- **Typical Providers**: Kimi, Claude Opus, Grok

### PR Writer (`pr-writer`)

Generates pull request descriptions and documentation.

- **Purpose**: Documentation, PR generation, changelog creation
- **Input**: Code changes, commit messages, context
- **Output**: PR description, summary, testing instructions
- **Typical Providers**: Claude, OpenAI, Anthropic

---

## 4. Execution Clients

Execution clients are adapters that normalize interaction with different agent systems.

### Model Clients

Direct language model providers:

| Provider | Type | Format |
|----------|------|--------|
| Anthropic | LLM | `anthropic/claude-opus` |
| OpenAI | LLM | `openai/gpt-4` |
| OpenRouter | Gateway | `openrouter/<model-name>` |
| Ollama | Local | `ollama/<model-name>` |

### Agent Clients

External agent systems:

| Provider | Type | Command |
|----------|------|---------|
| Claude Code | CLI Agent | `claude-code` |
| Codex | CLI Agent | `codex agent` |
| OpenClaw | Agent Runtime | `openclaw agent` |

---

## 5. Provider Configuration

Providers are configured in `library/providers/` or within individual agent definitions.

Example provider configuration:

```yaml
provider: anthropic
config:
  api_key: ${ANTHROPIC_API_KEY}
  temperature: 0.7
  max_tokens: 4096
```

### Environment Variables

Providers use environment variables for authentication:

- `ANTHROPIC_API_KEY` — Anthropic API key
- `OPENAI_API_KEY` — OpenAI API key
- `OPENROUTER_API_KEY` — OpenRouter API key
- `OLLAMA_BASE_URL` — Ollama server URL

---

## 6. Skills

A **skill** is a reusable, modular unit of agent behavior.

Skills are smaller than agents and focus on specific capabilities.

### Skill Structure

```
library/skills/
├── code-refactoring/
│   ├── skill.yaml
│   ├── prompt.md
│   └── schema.json
├── documentation-generation/
│   ├── skill.yaml
│   ├── prompt.md
│   └── examples/
└── README.md
```

### Skill Definition

Skills are defined in `skill.yaml`:

```yaml
id: extract-requirements
name: Extract Requirements from Code
description: Extracts functional and non-functional requirements from source code
version: 1.0.0

agent: repo-analyzer
provider: anthropic/claude-opus

input:
  type: object
  required:
    - source_code
    - context
  properties:
    source_code:
      type: string
      description: Source code to analyze
    context:
      type: string
      description: Additional context

output:
  type: object
  properties:
    requirements:
      type: array
      description: Extracted requirements
    dependencies:
      type: array
      description: Identified dependencies

prompt: ./prompt.md
examples:
  - input.json
  - expected_output.json
```

### Creating a Skill

1. Create a directory under `library/skills/`
2. Add `skill.yaml` with definition
3. Add `prompt.md` with the skill prompt
4. Add `schema.json` with input/output schemas (optional)
5. Add examples/ with test cases (recommended)

Example prompt.md:

```markdown
# Skill: Extract Code Metrics

You are tasked with analyzing source code and extracting quality metrics.

Given the provided source code, identify and report:

- Cyclomatic complexity
- Code duplication
- Function length distribution
- Test coverage indicators
- Dependency counts

Format your response as JSON.
```

---

## 7. Integrating Agents into Workflows

Agents are invoked in workflows through the `agent` step type.

### Agent Step

```yaml
steps:
  - id: analyze
    kind: agent
    agent: repo-analyzer
    provider: deepseek
    input:
      repository_path: ${inputs.repo_path}
      scope: full
    output:
      artifact: analysis_report

  - id: plan
    kind: agent
    agent: repo-planner
    provider: kimi
    input:
      requirements: ${inputs.requirements}
      analysis: ${steps.analyze.output}
    output:
      artifact: execution_plan

  - id: code-gen
    kind: agent
    agent: coder
    provider: codex
    input:
      plan: ${steps.plan.output}
      codebase_context: ${steps.analyze.output.code_structure}
    output:
      artifact: generated_code
```

---

## 8. Agent Composition

Complex workflows combine multiple agents.

### Multi-Agent Workflow Pattern

```yaml
workflow:
  id: automated-refactor
  description: Automated code refactoring pipeline

steps:
  - id: analyze        # Agent 1: Analyze
    kind: agent
    agent: repo-analyzer

  - id: plan           # Agent 2: Plan refactoring
    kind: agent
    agent: repo-planner
    input:
      analysis: ${steps.analyze.output}

  - id: implement      # Agent 3: Code generation
    kind: agent
    agent: coder
    input:
      plan: ${steps.plan.output}

  - id: review         # Agent 4: Code review
    kind: agent
    agent: code-reviewer
    input:
      original: ${inputs.source}
      refactored: ${steps.implement.output}
```

---

## 9. Best Practices

### Agent Selection

Choose agents based on task requirements:

- **Code generation**: Prefer Claude Code or Codex (specialized coding agents)
- **Analysis**: DeepSeek or Anthropic (reasoning capabilities)
- **Planning**: Kimi or Claude Opus (long-context, planning)
- **Documentation**: Claude or GPT-4 (writing quality)

### Provider Selection

Consider trade-offs:

| Factor | Consideration |
|--------|---------------|
| Latency | Local providers (Ollama) are faster |
| Cost | OpenRouter offers cost-effective models |
| Quality | Claude Opus, Kimi for complex reasoning |
| Availability | Use multiple providers as fallbacks |

### Input Formatting

- Provide clear, structured context
- Include relevant code snippets
- Specify output format expectations
- Use artifacts from previous steps

### Error Handling

Workflows should handle agent failures:

```yaml
steps:
  - id: analyze
    kind: agent
    agent: repo-analyzer
    retry:
      max_attempts: 3
      backoff: exponential
    on_failure:
      kind: notify
      message: "Analysis failed after retries"
```

---

## 10. Extending Agents

New agents can be added by:

1. Creating a new YAML definition in `library/agents/`
2. Configuring the target provider
3. Documenting capabilities and expected inputs/outputs
4. Adding to workflows that use them

Example new agent:

```yaml
# library/agents/security-auditor.yaml
id: security-auditor
description: Audits code for security vulnerabilities
model: anthropic/claude-opus

capabilities:
  - vulnerability_detection
  - security_best_practices
  - compliance_checking

config:
  focus_areas:
    - injection_attacks
    - authentication
    - encryption
    - data_validation
```

---

## 11. Skill Library

The skill library provides reusable, tested agent behaviors.

Current skills:

- Code refactoring patterns
- Documentation generation templates
- Analysis frameworks
- Code review procedures

Skills can be combined and reused across workflows.

---

## 12. Monitoring and Observability

Agent execution is tracked through:

- **Events**: `agent_started`, `agent_succeeded`, `agent_failed`
- **Artifacts**: Input and output artifacts are stored
- **Logs**: Agent invocation details are logged
- **Metrics**: Execution time, token usage (where applicable)

---

## 13. Configuration Reference

### Agent Configuration Example

```yaml
# library/agents/custom-agent.yaml
id: custom-agent
description: Custom agent for specific tasks
model: openrouter/deepseek-r1

config:
  temperature: 0.3
  top_p: 0.95
  max_tokens: 8192

capabilities:
  - task_specific_capability_1
  - task_specific_capability_2

input_schema:
  type: object
  required:
    - prompt
  properties:
    prompt:
      type: string
    context:
      type: object

output_schema:
  type: object
  properties:
    result:
      type: string
    metadata:
      type: object
```

---

## 14. Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System architecture
- [SPEC.md](./SPEC.md) — System specification
- [TEMPLATE_SPEC.md](./TEMPLATE_SPEC.md) — Workflow template syntax
- [ROADMAP.md](./ROADMAP.md) — Project roadmap

---

# End of AGENTS.md
