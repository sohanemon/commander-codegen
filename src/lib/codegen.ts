import path from 'node:path';
import { fail } from './jsdoc-helpers';
import type { CommandInfo, ParamInfo } from './types';

// NOTE: Naming helpers

function kebabFlagName(p: ParamInfo): string {
	return p.path.join('-');
}

function camelAccessorName(p: ParamInfo): string {
	return p.path
		.map((seg, i) =>
			i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1),
		)
		.join('');
}

// NOTE: Individual line builders

function buildOption(p: ParamInfo): string {
	const escapedDesc = JSON.stringify(p.description);
	const flag = kebabFlagName(p);

	if (p.kind === 'boolean') {
		return `.option('--${flag}', ${escapedDesc}${p.defaultValue ? `, ${p.defaultValue}` : ''})`;
	}
	if (p.kind === 'string[]' || p.kind === 'number[]') {
		return `.option('--${flag} <values...>', ${escapedDesc}, [])`;
	}
	if (p.kind === 'enum[]') {
		return `.addOption(new Option('--${flag} <values...>', ${escapedDesc}).choices(${JSON.stringify(p.choices)}))`;
	}
	if (p.kind === 'enum') {
		return `.addOption(new Option('--${flag} <value>', ${escapedDesc}).choices(${JSON.stringify(p.choices)})${p.defaultValue ? `.default(${p.defaultValue})` : ''})`;
	}
	return `.option('--${flag} <value>', ${escapedDesc}${p.defaultValue ? `, ${p.defaultValue}` : ''})`;
}

function buildArgumentLine(p: ParamInfo): string {
	// [name] (square brackets, optional at the Commander level) rather than
	// <name> — this is what lets Commander pass through undefined instead of
	// hard-failing, so the inquirer prompt fallback still gets a chance to run
	// when the positional value is omitted.
	return `.argument('[${kebabFlagName(p)}]', ${JSON.stringify(p.description)})`;
}

// NOTE: Nested object reconstruction

function buildNestedObjectLiteral(
	prefixPath: string[],
	allParams: ParamInfo[],
): string {
	const childKeys: string[] = [];
	for (const p of allParams) {
		if (
			p.path.length > prefixPath.length &&
			prefixPath.every((seg, i) => p.path[i] === seg)
		) {
			// biome-ignore lint/style/noNonNullAssertion: guard above ensures index is valid
			const key = p.path[prefixPath.length]!;
			if (!childKeys.includes(key)) childKeys.push(key);
		}
	}

	const fields = childKeys.map((key) => {
		const childPath = [...prefixPath, key];
		const leaf = allParams.find(
			(p) =>
				p.path.length === childPath.length &&
				p.path.every((seg, i) => seg === childPath[i]),
		);
		if (leaf) return `${key}: resolved.${camelAccessorName(leaf)}`;
		return `${key}: ${buildNestedObjectLiteral(childPath, allParams)}`;
	});

	return `{ ${fields.join(', ')} }`;
}

// NOTE: Call expression builder

function buildCallExpression(fnName: string, params: ParamInfo[]): string {
	const rootNames: string[] = [];
	for (const p of params) {
		// biome-ignore lint/style/noNonNullAssertion: p.path is non-empty — every param has at least one segment
		const rootName = p.path[0]!;
		if (!rootNames.includes(rootName)) rootNames.push(rootName);
	}

	const args = rootNames.map((root) => {
		const isNested = params.some(
			(p) => p.path[0] === root && p.path.length > 1,
		);
		if (isNested) return buildNestedObjectLiteral([root], params);

		const p = params.find((pp) => pp.path.length === 1 && pp.path[0] === root);
		if (!p)
			fail(fnName, `internal error: could not find root param "${root}".`);
		return `resolved.${camelAccessorName(p)}`;
	});

	return `${fnName}(${args.join(', ')})`;
}

// NOTE: Inquirer question builder

function buildInquirerQuestion(p: ParamInfo): string {
	const accessor = camelAccessorName(p);
	const message = JSON.stringify(p.description);

	if (p.kind === 'boolean') {
		return `{ type: 'confirm', name: '${accessor}', message: ${message}, default: false }`;
	}
	if (p.kind === 'enum') {
		return `{ type: 'select', name: '${accessor}', message: ${message}, choices: ${JSON.stringify(p.choices)} }`;
	}
	if (p.kind === 'enum[]') {
		return `{ type: 'checkbox', name: '${accessor}', message: ${message}, choices: ${JSON.stringify(p.choices)} }`;
	}
	if (p.kind === 'number') {
		return `{ type: 'input', name: '${accessor}', message: ${message}, filter: (v) => Number(v) }`;
	}
	if (p.kind === 'string[]' || p.kind === 'number[]') {
		const isNumeric = p.kind === 'number[]';
		return `{ type: 'input', name: '${accessor}', message: ${message} + ' (comma-separated)', filter: (v) => v.split(',').map((s) => s.trim())${isNumeric ? '.map(Number)' : ''} }`;
	}
	return `{ type: 'input', name: '${accessor}', message: ${message} }`;
}

// NOTE: Full command block builder

export function buildCommandBlock(c: CommandInfo): string {
	const positionalParams = c.argumentParams
		.map((argName) =>
			c.params.find((p) => p.path.length === 1 && p.path[0] === argName),
		)
		.filter((p): p is ParamInfo => p !== undefined);

	const positionalKeySet = new Set(
		positionalParams.map((p) => p.path.join('.')),
	);
	const flagParams = c.params.filter(
		(p) => !positionalKeySet.has(p.path.join('.')),
	);

	const argumentLines = positionalParams.map(buildArgumentLine);
	const optionLines = flagParams.map(buildOption);

	const requiredParams = flagParams.filter((p) => !p.optional);
	const questionsArray = requiredParams
		.map(buildInquirerQuestion)
		.join(',\n\t\t');

	const valuesAssignments = c.params
		.map((p) => {
			const positionalIndex = positionalParams.indexOf(p);
			if (positionalIndex !== -1) {
				return `${camelAccessorName(p)}: positionalArg${positionalIndex}`;
			}
			return `${camelAccessorName(p)}: opts.${camelAccessorName(p)}`;
		})
		.join(', ');

	const callExpr = buildCallExpression(c.fnName, c.params);
	const awaitedCall = c.isAsync ? `await ${callExpr}` : callExpr;

	const exampleHelp = c.examples.length
		? `\n  .addHelpText('after', ${JSON.stringify(`\nExamples:\n${c.examples.map((e) => `  $ ${e}`).join('\n')}`)})`
		: '';

	const actionParams = [
		...positionalParams.map((_, i) => `positionalArg${i}`),
		'opts',
	].join(', ');

	const promptBlock =
		requiredParams.length > 0
			? `
    const values = { ${valuesAssignments} };
    const missingQuestions = [
      ${questionsArray}
    ].filter((q) => (values as Record<string, unknown>)[q.name] === undefined);
    const answers = missingQuestions.length > 0 ? await inquirer.prompt(missingQuestions) : {};
    const resolved = { ...values, ...answers };`
			: `
    const resolved = { ${valuesAssignments} };`;

	return `program
  .command('${c.name}')${c.alias ? `\n  .alias('${c.alias}')` : ''}
  .description(${JSON.stringify(c.description)})
${[...argumentLines, ...optionLines].map((l) => `  ${l}`).join('\n')}${exampleHelp}
  .action(async (${actionParams}) => {${promptBlock}
    const result = ${awaitedCall};
    if (result !== undefined) console.log(result);
  });`;
}

// NOTE: Output file builder

export function buildOutputFile(
	commands: CommandInfo[],
	inputPath: string,
	outputPath: string,
): string {
	const usesOptionClass = commands.some((c) =>
		c.params.some((p) => p.kind === 'enum' || p.kind === 'enum[]'),
	);
	const imports = commands.map((c) => c.fnName).join(', ');

	const outputDir = path.dirname(outputPath);
	const inputNoExt = inputPath.replace(/\.ts$/, '');
	let relativeImport = path.relative(outputDir, inputNoExt).replace(/\\/g, '/');
	if (!relativeImport.startsWith('.')) relativeImport = `./${relativeImport}`;

	const commandBlocks = commands.map(buildCommandBlock).join('\n\n');
	const commanderImports = [
		'Command',
		...(usesOptionClass ? ['Option'] : []),
	].join(', ');

	return `// AUTO-GENERATED — do not edit by hand. Run \`commander-codegen\` to regenerate.
import { ${commanderImports} } from 'commander';
import inquirer from 'inquirer';
import { ${imports} } from '${relativeImport}';

export function registerCommands(program: Command): void {
${commandBlocks
	.split('\n')
	.map((l) => `  ${l}`)
	.join('\n')}
}
`;
}
