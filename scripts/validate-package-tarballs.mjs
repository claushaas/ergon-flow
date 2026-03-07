import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.dirname(
	fileURLToPath(new URL('../package.json', import.meta.url)),
);
const packageSpecs = [
	{
		dir: 'packages/shared',
		name: '@claushaas/ergon-shared',
		requiredEntries: ['package/package.json', 'package/README.md'],
	},
	{
		dir: 'packages/clients',
		name: '@claushaas/ergon-clients',
		requiredEntries: ['package/package.json', 'package/README.md'],
	},
	{
		dir: 'packages/storage',
		name: '@claushaas/ergon-storage',
		requiredEntries: [
			'package/package.json',
			'package/README.md',
			'package/dist/migrations/0001_init.sql',
		],
	},
	{
		dir: 'packages/engine',
		name: '@claushaas/ergon-engine',
		requiredEntries: ['package/package.json', 'package/README.md'],
	},
	{
		dir: 'packages/cli',
		name: '@claushaas/ergon-cli',
		requiredEntries: [
			'package/package.json',
			'package/README.md',
			'package/dist/main.js',
			'package/dist/library/workflows/code.refactor.yaml',
		],
	},
];
const forbiddenPrefixes = [
	'package/src/',
	'package/tests/',
	'package/docs/',
	'package/scripts/',
	'package/.github/',
];
const forbiddenEntries = [
	'package/pnpm-workspace.yaml',
	'package/biome.json',
	'package/tsconfig.json',
];

function fail(message) {
	throw new Error(message);
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: process.env,
	});
	if (result.status !== 0) {
		fail(
			[
				`Command failed: ${command} ${args.join(' ')}`,
				result.stdout.trim(),
				result.stderr.trim(),
			]
				.filter((part) => part.length > 0)
				.join('\n'),
		);
	}
	return result.stdout.trim();
}

function packWorkspacePackage(packageDir, packDir) {
	const output = run('pnpm', ['pack', '--pack-destination', packDir], packageDir);
	const tarballName = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.at(-1);

	if (!tarballName) {
		fail(`pnpm pack did not report a tarball for ${packageDir}`);
	}

	const tarballPath = path.isAbsolute(tarballName)
		? tarballName
		: path.join(packDir, tarballName);
	if (!existsSync(tarballPath)) {
		fail(`Expected packed tarball at ${tarballPath}`);
	}

	return tarballPath;
}

function listTarEntries(tarballPath) {
	return run('tar', ['-tf', tarballPath], repoRoot)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function assertTarballShape(spec, tarEntries) {
	for (const requiredEntry of spec.requiredEntries) {
		if (!tarEntries.includes(requiredEntry)) {
			fail(`Tarball for ${spec.name} is missing required entry "${requiredEntry}"`);
		}
	}

	if (!tarEntries.some((entry) => /^package\/dist\/.+\.js$/.test(entry))) {
		fail(`Tarball for ${spec.name} does not include any built JavaScript files`);
	}
	if (!tarEntries.some((entry) => /^package\/dist\/.+\.d\.ts$/.test(entry))) {
		fail(`Tarball for ${spec.name} does not include any TypeScript declarations`);
	}

	for (const forbiddenPrefix of forbiddenPrefixes) {
		if (tarEntries.some((entry) => entry.startsWith(forbiddenPrefix))) {
			fail(`Tarball for ${spec.name} contains forbidden prefix "${forbiddenPrefix}"`);
		}
	}
	for (const forbiddenEntry of forbiddenEntries) {
		if (tarEntries.includes(forbiddenEntry)) {
			fail(`Tarball for ${spec.name} contains forbidden entry "${forbiddenEntry}"`);
		}
	}
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'ergon-pack-validate-'));

try {
	for (const spec of packageSpecs) {
		const tarballPath = packWorkspacePackage(path.join(repoRoot, spec.dir), tempRoot);
		assertTarballShape(spec, listTarEntries(tarballPath));
	}
} finally {
	rmSync(tempRoot, { force: true, recursive: true });
}

process.stdout.write('All public package tarballs validated successfully.\n');
