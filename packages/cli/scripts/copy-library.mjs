import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const assetsToCopy = [
	{
		label: 'embedded library',
		sourceDir: path.join(repoRoot, 'library'),
		targetDir: path.join(packageDir, 'dist', 'library'),
	},
	{
		label: 'embedded skills',
		sourceDir: path.join(repoRoot, 'skill'),
		targetDir: path.join(packageDir, 'dist', 'skill'),
	},
];

for (const asset of assetsToCopy) {
	if (!existsSync(asset.sourceDir)) {
		throw new Error(
			`Cannot copy ${asset.label}; source directory is missing: ${asset.sourceDir}`,
		);
	}

	rmSync(asset.targetDir, { force: true, recursive: true });
	mkdirSync(path.dirname(asset.targetDir), { recursive: true });
	cpSync(asset.sourceDir, asset.targetDir, { recursive: true });
}
