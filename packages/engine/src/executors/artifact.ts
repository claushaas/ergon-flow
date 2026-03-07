import type { ArtifactStepDefinition } from '@claushaas/ergon-shared';
import type { ExecutionContext, Executor, ExecutorResult } from './index.js';

const RESERVED_ARTIFACT_KEYS = new Set([
	'__proto__',
	'constructor',
	'prototype',
]);

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

function isReservedArtifactKey(key: string): boolean {
	return RESERVED_ARTIFACT_KEYS.has(key);
}

function assertSafeArtifactName(name: string, stepId: string): string {
	if (!name || isReservedArtifactKey(name)) {
		throw new Error(`Artifact step "${stepId}" uses a reserved output name`);
	}
	return name;
}

function cloneArtifactValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return [...value];
	}
	if (isRecord(value)) {
		const copy: Record<string, unknown> = {};
		for (const [key, entryValue] of Object.entries(value)) {
			if (!isReservedArtifactKey(key)) {
				copy[key] = entryValue;
			}
		}
		return copy;
	}
	return value;
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
		if (
			!isRecord(current) ||
			isReservedArtifactKey(part) ||
			!Object.hasOwn(current, part)
		) {
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
				outputName: assertSafeArtifactName(args[0] || step.id, step.id),
				type,
			};
		case 'rename':
			if (!args[0]) {
				throw new Error(
					`Artifact step "${step.id}" requires a target name for rename`,
				);
			}
			return {
				outputName: assertSafeArtifactName(args[0], step.id),
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
				outputName: assertSafeArtifactName(args[1] || step.id, step.id),
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
				outputName: assertSafeArtifactName(args[1] || step.id, step.id),
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
				value = cloneArtifactValue(inputValue);
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
					for (const [key, artifactEntryValue] of Object.entries(
						artifactValue,
					)) {
						if (!isReservedArtifactKey(key)) {
							merged[key] = artifactEntryValue;
						}
					}
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
