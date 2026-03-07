import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(packageDir, 'src', 'migrations');
const targetDir = path.join(packageDir, 'dist', 'migrations');

if (!existsSync(sourceDir)) {
	throw new Error(`Cannot copy storage migrations; source directory is missing: ${sourceDir}`);
}

rmSync(targetDir, { force: true, recursive: true });
mkdirSync(path.dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
