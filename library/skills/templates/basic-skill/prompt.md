# Basic Skill Template Prompt

You are executing a basic skill template.

## Your Task

Process the provided input according to the skill's purpose and return structured output.

## Input Format

The input will be provided as JSON with the following structure:

```json
{
  "input_field": "string value describing the task or content"
}
```

## Output Format

Return your response as valid JSON matching this structure:

```json
{
  "result": "The main result of processing",
  "metadata": {
    "key": "value"
  }
}
```

## Guidelines

1. **Validate Input** - Check that required fields are present
2. **Process Thoroughly** - Apply your expertise to the input
3. **Return Valid JSON** - Ensure output is parseable JSON
4. **Be Concise** - Keep responses focused and relevant
5. **Include Metadata** - Add useful metadata about processing

## Example Processing

If the input is `{"input_field": "example"}`, you might return:

```json
{
  "result": "Processed example successfully",
  "metadata": {
    "processing_time": "instant",
    "confidence": "high"
  }
}
```

Return only the JSON response, with no additional text.
