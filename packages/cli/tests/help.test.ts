import { describe, expect, it } from 'vitest';
import { getCliHelpText, getCliVersionText } from '../src/help.js';

describe('CLI help and version surface', () => {
	it('renders a public help output with bootstrap guidance', () => {
		const helpText = getCliHelpText();

		expect(helpText).toContain('pnpm add -g @claushaas/ergon-cli');
		expect(helpText).toContain('ergon init [--root <path>] [--no-library]');
		expect(helpText).toContain(
			'ergon library sync [--force] [--root <path>] [--detach] [--reattach]',
		);
		expect(helpText).toContain('ergon skill install [skill_id]');
		expect(helpText).toContain('ergon run list');
		expect(helpText).toContain('ergon run status');
		expect(helpText).toContain(
			'Stateful commands require an initialized .ergon project.',
		);
		expect(helpText).toContain('Use "--no-library" to start detached.');
		expect(helpText).toContain('OPENROUTER_API_KEY');
	});

	it('renders the CLI version from package metadata', () => {
		expect(getCliVersionText()).toBe('0.2.1');
	});
});
