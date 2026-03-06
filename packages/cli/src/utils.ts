import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const WORKFLOW_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function hashFile(filePath: string): string {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function resolveWorkflowTemplatesDir(rootDir: string): string {
	return path.join(rootDir, 'library', 'workflows');
}

export function assertValidWorkflowId(workflowId: string): string {
	if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
		throw new Error(
			`Invalid workflow id "${workflowId}". Only lowercase letters, numbers, dots, dashes, and underscores are allowed.`,
		);
	}

	return workflowId;
}

export function resolvePathWithinBase(
	baseDir: string,
	unsafePath: string,
	label: string,
): string {
	if (path.isAbsolute(unsafePath)) {
		throw new Error(`Invalid ${label}: absolute paths are not allowed`);
	}

	const resolvedBase = path.resolve(baseDir);
	const resolvedPath = path.resolve(resolvedBase, unsafePath);
	const relative = path.relative(resolvedBase, resolvedPath);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Invalid ${label}: path escapes the workspace root`);
	}

	return resolvedPath;
}
