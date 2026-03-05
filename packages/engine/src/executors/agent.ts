import type {
	AgentResult,
	AgentStepDefinition,
	ArtifactType,
	ExecutionClient,
	Provider,
} from '@ergon/shared';
import { renderStepRequestPayload } from '../templating/index.js';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

export interface AgentExecutorOptions {
	resolveClient: (provider: Provider) => ExecutionClient;
}

function normalizeAgentArtifactName(step: AgentStepDefinition): string {
	if (step.output?.name) {
		return step.output.name;
	}
	if (step.id === 'analyze') {
		return 'analysis';
	}
	return step.id;
}

function tryParseJson(value: string): unknown | undefined {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function normalizeAgentArtifactType(
	step: AgentStepDefinition,
	artifactName: string,
	parsedJson: unknown,
): ArtifactType {
	if (step.output?.type) {
		return step.output.type;
	}
	if (artifactName === 'analysis') {
		return 'analysis';
	}
	if (artifactName === 'plan') {
		return 'plan';
	}
	if (parsedJson !== undefined) {
		return 'json';
	}
	return 'text';
}

export class AgentExecutor implements Executor<AgentStepDefinition> {
	public readonly kind = 'agent' as const;
	private readonly resolveClient: AgentExecutorOptions['resolveClient'];

	public constructor(options: AgentExecutorOptions) {
		this.resolveClient = options.resolveClient;
	}

	public async execute(
		step: AgentStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const payload = renderStepRequestPayload(step, {
			artifacts: context.artifacts,
			inputs: context.inputs,
		});
		if (!payload.prompt) {
			throw new Error(`Agent step "${step.id}" did not render a prompt`);
		}

		const client = this.resolveClient(step.provider);
		const request = {
			model: step.model,
			prompt: payload.prompt,
			provider: step.provider,
		} as const;
		const result: AgentResult = await client.run(request);
		const parsedJson = tryParseJson(result.text);
		const artifactName = normalizeAgentArtifactName(step);
		const artifactValue = parsedJson ?? result.text;
		const artifactType = normalizeAgentArtifactType(
			step,
			artifactName,
			parsedJson,
		);

		return {
			artifacts: [
				{
					name: artifactName,
					type: artifactType,
					value: artifactValue,
				},
			],
			outputs: {
				artifact_name: artifactName,
				attempt: context.run.attempt,
				provider: step.provider,
				request,
				response: result.raw ?? result.text,
				text: result.text,
			},
			status: 'succeeded',
		};
	}
}
