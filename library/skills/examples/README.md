# Example Skills

This directory contains well-documented example skills that demonstrate best practices.

## Available Examples

### Code Analysis Skill

Analyzes source code for patterns, quality metrics, and recommendations.

**Location**: `code-analysis/`
**Agent**: repo-analyzer
**Provider**: anthropic/claude-opus

### Documentation Generation Skill

Generates comprehensive documentation from code and comments.

**Location**: `doc-generation/`
**Agent**: pr-writer
**Provider**: anthropic/claude-opus

### Dependency Audit Skill

Analyzes dependencies for outdated packages, security vulnerabilities, and optimization opportunities.

**Location**: `dependency-audit/`
**Agent**: repo-analyzer
**Provider**: deepseek

## Using Example Skills

Copy an example skill to use it:

```bash
cp -r code-analysis ../my-code-analysis
# Customize as needed
```

## Creating Your Own Skills

Use the templates in the `templates/` directory:

```bash
cp -r ../templates/basic-skill ../my-new-skill
```

See [../README.md](../README.md) for detailed instructions.
