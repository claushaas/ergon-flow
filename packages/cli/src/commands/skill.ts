import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	statSync,
} from 'node:fs';
import path from 'node:path';
import { printJson } from '../output/format.js';
import { getEmbeddedSkillsDir } from '../project.js';

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface SkillInstallCommandOptions {
	destinationDir?: string;
	rootDir?: string;
}

export interface InstalledSkillSummary {
	destinationPath: string;
	filesCopied: number;
	rootDir: string;
	skillId: string;
	sourcePath: string;
}

function assertValidSkillId(skillId: string): string {
	if (!SKILL_ID_PATTERN.test(skillId)) {
		throw new Error(
			`Invalid skill id "${skillId}". Only lowercase letters, numbers, dots, dashes, and underscores are allowed.`,
		);
	}

	return skillId;
}

function listAvailableSkillIds(rootDir: string): string[] {
	const skillsDir = path.join(rootDir, 'skill');
	if (!existsSync(skillsDir) || !lstatSync(skillsDir).isDirectory()) {
		return [];
	}

	return readdirSync(skillsDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				!entry.isSymbolicLink() &&
				SKILL_ID_PATTERN.test(entry.name),
		)
		.map((entry) => entry.name)
		.filter((skillId) => {
			const manifestPath = path.join(skillsDir, skillId, 'SKILL.md');
			return existsSync(manifestPath) && lstatSync(manifestPath).isFile();
		})
		.sort();
}

function resolveSkillRoot(rootDir: string | undefined): string {
	if (rootDir) {
		return path.resolve(rootDir);
	}

	return path.dirname(getEmbeddedSkillsDir());
}

function resolveDestinationDir(destinationDir: string | undefined): string {
	if (!destinationDir) {
		return path.resolve(process.cwd(), 'skills');
	}

	return path.resolve(destinationDir);
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): number {
	const sourceStats = lstatSync(sourceDir);
	if (sourceStats.isSymbolicLink()) {
		throw new Error(
			`Skill source contains a symbolic link at "${sourceDir}", which is not allowed for security reasons.`,
		);
	}
	mkdirSync(targetDir, { recursive: true });
	let copiedFiles = 0;

	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);
		const sourcePathStats = lstatSync(sourcePath);

		if (sourcePathStats.isSymbolicLink()) {
			throw new Error(
				`Skill source contains a symbolic link at "${sourcePath}", which is not allowed for security reasons.`,
			);
		}

		if (entry.isDirectory()) {
			copiedFiles += copyDirectoryRecursive(sourcePath, targetPath);
			continue;
		}

		if (entry.isFile()) {
			mkdirSync(path.dirname(targetPath), { recursive: true });
			copyFileSync(sourcePath, targetPath);
			copiedFiles += 1;
		}
	}

	return copiedFiles;
}

function resolveSkillId(skillId: string | undefined, rootDir: string): string {
	if (skillId) {
		return assertValidSkillId(skillId);
	}

	const availableSkillIds = listAvailableSkillIds(rootDir);
	if (availableSkillIds.length === 1) {
		return availableSkillIds[0];
	}

	if (availableSkillIds.length === 0) {
		throw new Error(
			`No repo-distributed skills were found under "${path.join(rootDir, 'skill')}".`,
		);
	}

	throw new Error(
		`Multiple skills are available under "${path.join(rootDir, 'skill')}": ${availableSkillIds.join(', ')}. Pass an explicit skill id.`,
	);
}

export function installSkill(
	skillId: string | undefined,
	commandOptions: SkillInstallCommandOptions = {},
): InstalledSkillSummary {
	const rootDir = resolveSkillRoot(commandOptions.rootDir);
	const normalizedSkillId = resolveSkillId(skillId, rootDir);
	const sourcePath = path.join(rootDir, 'skill', normalizedSkillId);
	if (!existsSync(sourcePath)) {
		throw new Error(
			`Skill "${normalizedSkillId}" was not found under "${path.join(rootDir, 'skill')}".`,
		);
	}
	if (lstatSync(sourcePath).isSymbolicLink()) {
		throw new Error(
			`Skill "${normalizedSkillId}" at "${sourcePath}" is a symbolic link, which is not allowed for security reasons.`,
		);
	}

	const skillManifestPath = path.join(sourcePath, 'SKILL.md');
	if (!existsSync(skillManifestPath) || !statSync(skillManifestPath).isFile()) {
		throw new Error(
			`Skill "${normalizedSkillId}" was not found under "${path.join(rootDir, 'skill')}".`,
		);
	}

	const destinationDir = resolveDestinationDir(commandOptions.destinationDir);
	const destinationPath = path.join(destinationDir, normalizedSkillId);

	if (existsSync(destinationPath)) {
		throw new Error(
			`Skill destination already exists at "${destinationPath}". Remove it or choose another --path.`,
		);
	}

	const filesCopied = copyDirectoryRecursive(sourcePath, destinationPath);

	return {
		destinationPath,
		filesCopied,
		rootDir,
		skillId: normalizedSkillId,
		sourcePath,
	};
}

export function runSkillInstallCommand(
	skillId: string | undefined,
	commandOptions: SkillInstallCommandOptions = {},
): void {
	printJson(installSkill(skillId, commandOptions));
}
