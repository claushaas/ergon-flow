import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			'@ergon/clients': path.join(rootDir, 'packages/clients/src/index.ts'),
			'@ergon/engine': path.join(rootDir, 'packages/engine/src/index.ts'),
			'@ergon/executors': path.join(rootDir, 'packages/executors/src/index.ts'),
			'@ergon/shared': path.join(rootDir, 'packages/shared/src/index.ts'),
			'@ergon/storage': path.join(rootDir, 'packages/storage/src/index.ts'),
		},
	},
	test: {
		include: ['packages/*/tests/**/*.test.ts'],
	},
});
