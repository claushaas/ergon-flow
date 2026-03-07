import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(
	fileURLToPath(new URL('../package.json', import.meta.url)),
);
const packageJsonPaths = [
	'package.json',
	'packages/shared/package.json',
	'packages/clients/package.json',
	'packages/storage/package.json',
	'packages/engine/package.json',
	'packages/cli/package.json',
];

function fail(message) {
	throw new Error(message);
}

function readVersion(relativePath) {
	const filePath = path.join(repoRoot, relativePath);
	const packageJson = JSON.parse(readFileSync(filePath, 'utf8'));
	if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
		fail(`Missing version in ${relativePath}`);
	}
	return packageJson.version;
}

const discoveredVersions = new Map(
	packageJsonPaths.map((relativePath) => [relativePath, readVersion(relativePath)]),
);
const uniqueVersions = new Set(discoveredVersions.values());
if (uniqueVersions.size !== 1) {
	fail(
		`Workspace versions are inconsistent: ${Array.from(discoveredVersions.entries())
			.map(([file, version]) => `${file}=${version}`)
			.join(', ')}`,
	);
}

const tagInput = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tagInput) {
	process.stdout.write(
		`${Array.from(uniqueVersions)[0]} (no release tag supplied, version consistency only)\n`,
	);
	process.exit(0);
}

const normalizedTagVersion = tagInput.startsWith('v')
	? tagInput.slice(1)
	: tagInput;
const workspaceVersion = Array.from(uniqueVersions)[0];
if (normalizedTagVersion !== workspaceVersion) {
	fail(
		`Release tag "${tagInput}" does not match workspace version "${workspaceVersion}"`,
	);
}

process.stdout.write(`${workspaceVersion}\n`);
