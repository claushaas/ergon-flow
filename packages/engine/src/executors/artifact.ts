import type { ArtifactStepDefinition } from '@ergon/shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

type ParsedArtifactOperation =
	| {
			outputName: string;
			type: 'copy' | 'rename';
	  }
	| {
			extractPath: string;
			outputName: string;
			type: 'extract';
	  }
	| {
			mergeInputs: string[];
			outputName: string;
			type: 'merge';
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPathValue(source: unknown, path: string): unknown {
	const pathParts = path
		.split('.')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (pathParts.length === 0) {
		throw new Error(
			'Artifact extract operation requires a non-empty field path',
		);
	}

	let current: unknown = source;
	for (const part of pathParts) {
		if (!isRecord(current) || !(part in current)) {
			throw new Error(`Artifact field "${path}" was not found`);
		}
		current = current[part];
	}
	return current;
}

function parseOperation(step: ArtifactStepDefinition): ParsedArtifactOperation {
	const [rawType, ...rawArgs] = step.operation.split(':');
	const type = rawType?.trim();
	const args = rawArgs.map((part) => part.trim());

	switch (type) {
		case 'copy':
			return {
				outputName: args[0] || step.id,
				type,
			};
		case 'rename':
			if (!args[0]) {
				throw new Error(
					`Artifact step "${step.id}" requires a target name for rename`,
				);
			}
			return {
				outputName: args[0],
				type,
			};
		case 'extract':
			if (!args[0]) {
				throw new Error(
					`Artifact step "${step.id}" requires a field path for extract`,
				);
			}
			return {
				extractPath: args[0],
				outputName: args[1] || step.id,
				type,
			};
		case 'merge': {
			const mergeInputs = args[0]
				?.split(',')
				.map((value) => value.trim())
				.filter((value) => value.length > 0);
			if (!mergeInputs || mergeInputs.length === 0) {
				throw new Error(
					`Artifact step "${step.id}" requires at least one artifact for merge`,
				);
			}
			return {
				mergeInputs,
				outputName: args[1] || step.id,
				type,
			};
		}
		default:
			throw new Error(
				`Artifact step "${step.id}" uses unsupported operation "${step.operation}"`,
			);
	}
}

export class ArtifactExecutor implements Executor<ArtifactStepDefinition> {
	public readonly kind = 'artifact' as const;

	public async execute(
		step: ArtifactStepDefinition,
		context: ExecutionContext,
	): Promise<ExecutorResult> {
		const operation = parseOperation(step);
		const inputValue = context.getRequiredArtifact(step.input);

		let value: unknown;
		switch (operation.type) {
			case 'copy':
			case 'rename':
				value = inputValue;
				break;
			case 'extract':
				value = getPathValue(inputValue, operation.extractPath);
				break;
			case 'merge': {
				if (!isRecord(inputValue)) {
					throw new Error(
						`Artifact step "${step.id}" requires object input for merge`,
					);
				}
				const merged: Record<string, unknown> = { ...inputValue };
				for (const artifactName of operation.mergeInputs) {
					const artifactValue = context.getRequiredArtifact(artifactName);
					if (!isRecord(artifactValue)) {
						throw new Error(
							`Artifact step "${step.id}" requires object artifact "${artifactName}" for merge`,
						);
					}
					Object.assign(merged, artifactValue);
				}
				value = merged;
				break;
			}
		}

		return {
			artifacts: [
				{
					name: operation.outputName,
					type: 'json',
					value,
				},
			],
			outputs: {
				input: step.input,
				name: operation.outputName,
				operation: step.operation,
			},
			status: 'succeeded',
		};
	}
}
