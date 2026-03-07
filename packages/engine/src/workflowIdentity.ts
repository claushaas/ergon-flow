import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function hashFileContent(filePath: string): string {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function assertWorkflowTemplateIdentity(
	templatePath: string,
	expectedHash: string,
	failureMessage: string,
): void {
	const currentHash = hashFileContent(templatePath);
	if (currentHash !== expectedHash) {
		throw new Error(failureMessage);
	}
}
