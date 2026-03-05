# Ergon Flow Skills Library

Reusable, modular skill definitions for Ergon Flow agents.

## Directory Structure

```
skills/
├── README.md                          # This file
├── templates/                         # Skill templates and scaffolding
│   ├── basic-skill/                   # Basic skill template
│   │   ├── skill.yaml
│   │   ├── prompt.md
│   │   └── schema.json
│   └── agent-skill/                   # Agent-based skill template
│       ├── skill.yaml
│       ├── prompt.md
│       ├── schema.json
│       └── examples/
├── examples/                          # Example skills (well-documented)
│   ├── code-analysis/
│   ├── doc-generation/
│   └── dependency-audit/
└── [skill-name]/                      # Custom skills
    ├── skill.yaml                     # Skill definition
    ├── prompt.md                      # Prompt template
    ├── schema.json                    # Input/output schema (optional)
    ├── examples/                      # Test cases and examples
    │   ├── example1.input.json
    │   └── example1.output.json
    └── README.md                      # Skill documentation (optional)
```

## Creating a Skill

### 1. Basic Skill Structure

A skill requires at minimum:

```yaml
# skill.yaml
id: my-skill
name: My Skill Name
description: Description of what the skill does
version: 1.0.0

agent: agent-id                    # Which agent implements this
provider: anthropic/claude-opus    # Which provider to use

# Input schema (what the skill accepts)
input:
  type: object
  required:
    - text
  properties:
    text:
      type: string
      description: Input text

# Output schema (what the skill produces)
output:
  type: object
  properties:
    result:
      type: string
      description: The result

prompt: ./prompt.md
```

### 2. Create a Prompt

Create `prompt.md` with instructions for the agent:

```markdown
# Skill Prompt

You are executing the "My Skill" skill.

Your task:
- Take the provided input
- Process it according to these rules
- Return structured output

## Input Format

The input will be provided as JSON with the following structure:
- `text`: The text to process

## Output Format

Return your response as valid JSON matching this structure:
```json
{
  "result": "Your result here"
}
```

## Guidelines

- Be concise and specific
- Validate input before processing
- Return valid JSON only
```

### 3. Define Input/Output Schema

Create `schema.json` (optional but recommended):

```json
{
  "input": {
    "type": "object",
    "required": ["text"],
    "properties": {
      "text": {
        "type": "string",
        "description": "Input text"
      }
    }
  },
  "output": {
    "type": "object",
    "properties": {
      "result": {
        "type": "string",
        "description": "Processing result"
      }
    }
  }
}
```

### 4. Add Examples

Create examples in the `examples/` directory:

**example1.input.json**:
```json
{
  "text": "sample input"
}
```

**example1.output.json**:
```json
{
  "result": "expected output"
}
```

### 5. Using the Skill in a Workflow

Skills are used like any agent step:

```yaml
steps:
  - id: my-step
    kind: agent
    agent: my-agent
    provider: anthropic/claude-opus
    input:
      text: ${inputs.some_text}
    output:
      artifact: my_result
```

Or reference the skill directly:

```yaml
steps:
  - id: my-step
    kind: skill
    skill: my-skill
    input:
      text: ${inputs.some_text}
    output:
      artifact: my_result
```

## Skill Best Practices

### Design Principles

1. **Single Responsibility** — Each skill should do one thing well
2. **Clear Inputs** — Document exactly what the skill expects
3. **Structured Output** — Return consistent, parseable results
4. **Error Handling** — Handle edge cases gracefully
5. **Reusability** — Design for use across multiple workflows

### Naming Conventions

- Use kebab-case for skill directory names
- Use lowercase with hyphens in `id` field
- Use Title Case for `name` field
- Use Present Tense: "Extract", "Generate", "Analyze"

### Documentation

Every skill should include:

- Clear description of purpose
- Required inputs with types
- Expected outputs with formats
- Example usage
- Error scenarios and handling

### Testing

For each skill:

1. Create at least 2 examples with varied inputs
2. Document expected behaviors
3. Include edge cases in examples
4. Validate against schema

## Skill Versioning

Update the version field when making changes:

- **1.0.0** → Initial release
- **1.0.1** → Bug fixes
- **1.1.0** → New features
- **2.0.0** → Breaking changes

## Available Agents for Skills

See [AGENTS.md](../docs/AGENTS.md) for details on available agents:

- `coder` — Code generation and modification
- `repo-analyzer` — Repository analysis
- `repo-planner` — Planning and task breakdown
- `pr-writer` — Documentation and PR generation

## Skill Categories

### Code Skills

- Code analysis
- Code generation
- Code refactoring
- Code review

### Documentation Skills

- API documentation generation
- README generation
- Architecture documentation
- Comment generation

### Analysis Skills

- Dependency analysis
- Security analysis
- Performance analysis
- Code quality analysis

### Planning Skills

- Task planning
- Architecture planning
- Refactoring planning
- Testing planning

## Contributing Skills

To add a skill to the library:

1. Create the skill following the structure above
2. Add comprehensive examples
3. Document thoroughly
4. Test against the examples
5. Create a PR with clear description

## Using Templates

Start with one of the provided templates:

```bash
cp -r templates/basic-skill library/skills/my-new-skill
# Edit skill.yaml, prompt.md, and examples
```

## Resources

- [AGENTS.md](../docs/AGENTS.md) — Agent guide
- [SPEC.md](../docs/SPEC.md) — System specification
- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) — Architecture details
- [TEMPLATE_SPEC.md](../docs/TEMPLATE_SPEC.md) — Workflow template syntax
