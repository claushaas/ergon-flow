import { describe, expect, it } from 'vitest';
import { getCliHelpText, getCliVersionText } from '../src/help.js';

describe('CLI help and version surface', () => {
	it('renders a public help output with bootstrap guidance', () => {
		const helpText = getCliHelpText();

		expect(helpText).toContain('pnpm add -g @ergon/cli');
		expect(helpText).toContain('ergon init');
		expect(helpText).toContain('ergon library sync');
		expect(helpText).toContain(
			'Stateful commands require an initialized .ergon project.',
		);
		expect(helpText).toContain('OPENROUTER_API_KEY');
	});

	it('renders the CLI version from package metadata', () => {
		expect(getCliVersionText()).toBe('0.1.1');
	});
});
