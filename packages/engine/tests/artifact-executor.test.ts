import type { ArtifactStepDefinition } from '@ergon/shared';
import { describe, expect, it } from 'vitest';
import { ArtifactExecutor } from '../src/executors/artifact.js';
import { createExecutionContext } from '../src/executors/index.js';

function createTestContext() {
	return createExecutionContext({
		artifacts: {
			analysis: {
				details: {
					severity: 'high',
				},
				summary: 'needs refactor',
			},
			patch_meta: {
				files: 3,
			},
			run_summary: {
				status: 'ready',
			},
		},
		inputs: {},
		run: {
			attempt: 1,
			runId: 'run_1',
			stepIndex: 5,
			workflowId: 'code.refactor',
			workflowVersion: 1,
		},
	});
}

describe('ArtifactExecutor (E7)', () => {
	it('copies a JSON artifact under a new name', async () => {
		const executor = new ArtifactExecutor();
		const step: ArtifactStepDefinition = {
			id: 'artifact.copy',
			input: 'analysis',
			kind: 'artifact',
			operation: 'copy:analysis.copy',
		};

		const result = await executor.execute(step, createTestContext());

		expect(result).toEqual({
			artifacts: [
				{
					name: 'analysis.copy',
					type: 'json',
					value: {
						details: {
							severity: 'high',
						},
						summary: 'needs refactor',
					},
				},
			],
			outputs: {
				input: 'analysis',
				name: 'analysis.copy',
				operation: 'copy:analysis.copy',
			},
			status: 'succeeded',
		});
	});

	it('renames a JSON artifact to the requested output name', async () => {
		const executor = new ArtifactExecutor();
		const step: ArtifactStepDefinition = {
			id: 'artifact.rename',
			input: 'analysis',
			kind: 'artifact',
			operation: 'rename:run.summary',
		};

		const result = await executor.execute(step, createTestContext());

		expect(result).toEqual({
			artifacts: [
				{
					name: 'run.summary',
					type: 'json',
					value: {
						details: {
							severity: 'high',
						},
						summary: 'needs refactor',
					},
				},
			],
			outputs: {
				input: 'analysis',
				name: 'run.summary',
				operation: 'rename:run.summary',
			},
			status: 'succeeded',
		});
	});

	it('extracts a nested field from a JSON artifact', async () => {
		const executor = new ArtifactExecutor();
		const step: ArtifactStepDefinition = {
			id: 'artifact.extract',
			input: 'analysis',
			kind: 'artifact',
			operation: 'extract:details.severity:analysis.severity',
		};

		const result = await executor.execute(step, createTestContext());

		expect(result).toEqual({
			artifacts: [
				{
					name: 'analysis.severity',
					type: 'json',
					value: 'high',
				},
			],
			outputs: {
				input: 'analysis',
				name: 'analysis.severity',
				operation: 'extract:details.severity:analysis.severity',
			},
			status: 'succeeded',
		});
	});

	it('merges the input artifact with additional JSON artifacts', async () => {
		const executor = new ArtifactExecutor();
		const step: ArtifactStepDefinition = {
			id: 'artifact.merge',
			input: 'analysis',
			kind: 'artifact',
			operation: 'merge:patch_meta,run_summary:merged.summary',
		};

		const result = await executor.execute(step, createTestContext());

		expect(result).toEqual({
			artifacts: [
				{
					name: 'merged.summary',
					type: 'json',
					value: {
						details: {
							severity: 'high',
						},
						files: 3,
						status: 'ready',
						summary: 'needs refactor',
					},
				},
			],
			outputs: {
				input: 'analysis',
				name: 'merged.summary',
				operation: 'merge:patch_meta,run_summary:merged.summary',
			},
			status: 'succeeded',
		});
	});

	it('rejects unsupported operations, reserved names and invalid merge sources', async () => {
		const executor = new ArtifactExecutor();
		const unsupportedStep: ArtifactStepDefinition = {
			id: 'artifact.bad',
			input: 'analysis',
			kind: 'artifact',
			operation: 'format',
		};
		const invalidMergeStep: ArtifactStepDefinition = {
			id: 'artifact.merge',
			input: 'analysis',
			kind: 'artifact',
			operation: 'merge:analysis.summary',
		};
		const reservedNameStep: ArtifactStepDefinition = {
			id: 'artifact.reserved',
			input: 'analysis',
			kind: 'artifact',
			operation: 'copy:__proto__',
		};

		await expect(
			executor.execute(unsupportedStep, createTestContext()),
		).rejects.toThrow(
			'Artifact step "artifact.bad" uses unsupported operation "format"',
		);
		await expect(
			executor.execute(invalidMergeStep, createTestContext()),
		).rejects.toThrow(
			'Artifact "analysis.summary" was not found in execution context',
		);
		await expect(
			executor.execute(reservedNameStep, createTestContext()),
		).rejects.toThrow(
			'Artifact step "artifact.reserved" uses a reserved output name',
		);
	});

	it('does not expose prototype-chain values through extract paths', async () => {
		const executor = new ArtifactExecutor();
		const step: ArtifactStepDefinition = {
			id: 'artifact.extract',
			input: 'analysis',
			kind: 'artifact',
			operation: 'extract:__proto__.polluted',
		};

		await expect(executor.execute(step, createTestContext())).rejects.toThrow(
			'Artifact field "__proto__.polluted" was not found',
		);
	});
});
