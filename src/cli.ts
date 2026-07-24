#!/usr/bin/env node

import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { generate } from './lib/generate';

const program = new Command();

program
	.name(packageJson.name)
	.description(packageJson.description ?? '')
	.version(packageJson.version)
	.option(
		'-i, --input <path>',
		'Entry file with documented exports',
		'src/index.ts',
	)
	.option(
		'-o, --output <path>',
		'Generated commander file',
		'src/lib/generated/commands.gen.ts',
	)
	.option('-c, --check', 'Validate only, do not write output')
	.option(
		'--cwd <path>',
		'Run as if invoked from this directory',
		process.cwd(),
	)
	.showSuggestionAfterError();

program.action((opts) => {
	try {
		const result = generate({
			input: opts.input,
			output: opts.output,
			cwd: opts.cwd,
			checkOnly: opts.check,
		});

		if (opts.check) {
			console.log(
				`✓ ${result.commandCount} command(s) would generate successfully.`,
			);
		} else {
			console.log(
				`Generated ${result.commandCount} command(s) in ${result.outputPath}`,
			);
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}
});

program.parse();
