import fs from 'node:fs';
import path from 'node:path';
import {
	type FunctionDeclaration,
	type JSDoc,
	JSDocParameterTag,
	Project,
	SyntaxKind,
	type Type,
} from 'ts-morph';

// NOTE: Param type definitions

type ParamKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'string[]'
	| 'number[]'
	| 'enum'
	| 'enum[]';

interface ParamInfo {
	path: string[];
	kind: ParamKind;
	optional: boolean;
	defaultValue: string | undefined;
	description: string;
	choices?: string[];
}

interface CommandInfo {
	name: string;
	alias: string | undefined;
	description: string;
	examples: string[];
	fnName: string;
	params: ParamInfo[];
	isAsync: boolean;
	argumentParams: string[]; // top-level param names tagged @argument, in declaration order
}

// NOTE: Throw with export name for traceability

function fail(exportName: string, message: string): never {
	throw new Error(`[generate] "${exportName}": ${message}`);
}

// NOTE: TSDoc extraction helpers

function getTagText(
	jsDoc: JSDoc | undefined,
	tagName: string,
): string | undefined {
	return jsDoc
		?.getTags()
		.find((t) => t.getTagName() === tagName)
		?.getComment()
		?.toString()
		.trim();
}

function getAllTagTexts(jsDoc: JSDoc | undefined, tagName: string): string[] {
	return (
		jsDoc
			?.getTags()
			.filter((t) => t.getTagName() === tagName)
			.map((t) => t.getComment()?.toString().trim() ?? '')
			.filter((text) => text.length > 0) ?? []
	);
}

function parseNameDescriptionTag(raw: string): {
	name: string;
	description: string;
} {
	const [firstWord, ...restWords] = raw.split(/\s+/);
	const name = firstWord ?? '';
	const rest = restWords.join(' ');

	// Handle optional "- " prefix in the description (a JSDoc convention)
	// e.g. "name - description" or "input input - output - processing"
	if (rest.startsWith('- ')) {
		return { name, description: rest.slice(2).trim() };
	}

	return { name, description: rest.trim() };
}

// @argument and @option both supply per-param descriptions. @argument marks
// a param as a positional CLI argument; @option keeps it as a --flag.
//
// ts-morph parses @argument as JSDocParameterTag (name extracted separately),
// but @option as a plain JSDocTag (name + description in one comment).
function getArgOrOptionTagMap(
	jsDoc: JSDoc | undefined,
	tagName: 'argument' | 'option',
): Map<string, string> {
	const map = new Map<string, string>();
	if (!jsDoc) return map;

	for (const tag of jsDoc.getTags()) {
		if (tag.getTagName() !== tagName) continue;

		if (tagName === 'argument' && tag instanceof JSDocParameterTag) {
			// JSDocParameterTag — ts-morph separates name from comment
			const name = String(tag.getName());
			let desc = tag.getComment()?.toString().trim() ?? '';
			// Strip leading "- " convention (e.g. @argument name - the description)
			if (desc.startsWith('- ')) desc = desc.slice(2).trim();
			if (name.length > 0 && desc.length > 0) map.set(name, desc);
			continue;
		}

		// Plain JSDocTag (e.g. @option) — name is first word, rest is description
		const raw = tag.getComment()?.toString().trim() ?? '';
		const { name, description } = parseNameDescriptionTag(raw);
		if (name.length > 0 && description.length > 0) map.set(name, description);
	}

	return map;
}

// NOTE: Type resolution — parse TS types to ParamKind

function tryResolveLeafKind(
	type: Type,
): { kind: ParamKind; choices?: string[] } | null {
	const typeText = type.getText();

	if (typeText === 'string') return { kind: 'string' };
	if (typeText === 'number') return { kind: 'number' };
	if (typeText === 'boolean') return { kind: 'boolean' };

	if (type.isStringLiteral()) {
		return { kind: 'enum', choices: [String(type.getLiteralValue())] };
	}

	if (type.isNumberLiteral()) {
		return { kind: 'enum', choices: [String(type.getLiteralValue())] };
	}

	if (type.isArray()) {
		const elementType = type.getArrayElementTypeOrThrow();
		if (
			elementType.isUnion() &&
			elementType.getUnionTypes().every((m) => m.isStringLiteral())
		) {
			const choices = elementType
				.getUnionTypes()
				.map((m) => String(m.getLiteralValue()));
			return { kind: 'enum[]', choices };
		}
	}

	if (typeText === 'string[]' || typeText === 'Array<string>')
		return { kind: 'string[]' };
	if (typeText === 'number[]' || typeText === 'Array<number>')
		return { kind: 'number[]' };

	if (type.isUnion()) {
		const members = type.getUnionTypes();
		const allStringLiterals = members.every((m) => m.isStringLiteral());
		if (allStringLiterals) {
			const choices = members.map((m) => String(m.getLiteralValue()));
			return { kind: 'enum', choices };
		}
		// A union, but not one made entirely of string literals — this is
		// explicitly unsupported (e.g. `string | number`), and fails here with
		// a clear message rather than falling through to be misread as an
		// object (unions expose shared prototype members like toString via
		// getProperties(), which would otherwise trip the call-signature guard
		// with a confusing error).
		return null;
	}

	return null;
}

function expandParam(
	exportName: string,
	fieldPath: string[],
	rawType: Type,
	parentOptional: boolean,
	paramDescriptions: Map<string, string>,
): ParamInfo[] {
	const type = rawType.getNonNullableType();
	const dottedKey = fieldPath.join('.');

	const leaf = tryResolveLeafKind(type);
	if (leaf) {
		const lastSegment = fieldPath[fieldPath.length - 1];
		const description =
			paramDescriptions.get(dottedKey) ?? `${lastSegment} (${leaf.kind})`;
		return [
			{
				path: fieldPath,
				kind: leaf.kind,
				optional: parentOptional,
				defaultValue: undefined,
				description,
				choices: leaf.choices,
			},
		];
	}

	if (type.isUnion()) {
		fail(
			exportName,
			`parameter "${dottedKey}" has unsupported union type "${rawType.getText()}". Only unions where every member is a string literal (e.g. 'a' | 'b') are supported.`,
		);
	}

	if (type.isArray()) {
		fail(
			exportName,
			`parameter "${dottedKey}" is an array of non-primitive items. Arrays of objects aren't supported by codegen — write this command by hand instead.`,
		);
	}

	const props = type.getProperties();
	if (props.length === 0) {
		fail(
			exportName,
			`parameter "${dottedKey}" has unsupported type "${rawType.getText()}". Supported: string, number, boolean, string[], number[], string-literal unions, arrays of string-literal unions, or flat/nested objects of the above.`,
		);
	}

	for (const prop of props) {
		const decl = prop.getDeclarations()[0];
		const propType = decl
			? prop.getTypeAtLocation(decl)
			: prop.getValueDeclaration()?.getType();
		if (propType && propType.getCallSignatures().length > 0) {
			fail(
				exportName,
				`parameter "${dottedKey}" resolved to a type with method-like properties (e.g. "${prop.getName()}"). This usually means the type wasn't recognized as a primitive/enum and was incorrectly treated as an object. Original type: "${rawType.getText()}".`,
			);
		}
	}

	return props.flatMap((prop) => {
		const propName = prop.getName();
		const decl = prop.getDeclarations()[0];
		const propType = decl
			? prop.getTypeAtLocation(decl)
			: prop.getValueDeclaration()?.getType();
		if (!propType) {
			fail(
				exportName,
				`could not resolve type of property "${dottedKey}.${propName}".`,
			);
		}
		const propOptional = prop.isOptional() || parentOptional;
		return expandParam(
			exportName,
			[...fieldPath, propName],
			propType,
			propOptional,
			paramDescriptions,
		);
	});
}

// NOTE: Build CommandInfo from a function declaration

function extractCommandInfo(
	exportName: string,
	fn: FunctionDeclaration,
): CommandInfo {
	const jsDoc = fn.getJsDocs()[0];

	if (!jsDoc) {
		fail(
			exportName,
			'missing JSDoc block entirely. Every exported function needs at least @description.',
		);
	}

	const name = getTagText(jsDoc, 'name') ?? exportName;
	const description = getTagText(jsDoc, 'description');
	const alias = getTagText(jsDoc, 'alias');
	const examples = getAllTagTexts(jsDoc, 'example');

	if (!description) fail(exportName, 'missing required @description tag.');

	const argMap = getArgOrOptionTagMap(jsDoc, 'argument');
	const optionMap = getArgOrOptionTagMap(jsDoc, 'option');

	for (const key of argMap.keys()) {
		if (optionMap.has(key)) {
			fail(
				exportName,
				`parameter "${key}" is tagged both @argument and @option. Use only one.`,
			);
		}
	}

	const paramDescriptions = new Map<string, string>([...argMap, ...optionMap]);
	const fnParams = fn.getParameters();

	const params: ParamInfo[] = fnParams.flatMap((p) => {
		const paramName = p.getName();
		const optional = p.isOptional() || p.hasInitializer();
		const defaultValue = p.getInitializer()?.getText();
		const expanded = expandParam(
			exportName,
			[paramName],
			p.getType(),
			optional,
			paramDescriptions,
		);

		if (expanded.length === 1 && defaultValue !== undefined) {
			const first = expanded[0];
			if (first) {
				expanded[0] = { ...first, defaultValue };
			}
		}

		return expanded;
	});

	// @argument tags are validated against the resolved params: must exist,
	// must be required, must be string/number (enums/booleans/arrays can't
	// be positional — they stay flags regardless of tagging).
	const argumentParams = [...argMap.keys()];
	for (const argName of argumentParams) {
		const target = params.find(
			(p) => p.path.length === 1 && p.path[0] === argName,
		);
		if (!target) {
			fail(
				exportName,
				`@argument "${argName}" does not match any top-level parameter name.`,
			);
		}
		if (target.optional) {
			fail(
				exportName,
				`@argument "${argName}" must be a required parameter, not optional.`,
			);
		}
		if (target.kind !== 'string' && target.kind !== 'number') {
			fail(
				exportName,
				`@argument "${argName}" must be a string or number parameter. Enums, booleans, and arrays can't be positional.`,
			);
		}
	}

	return {
		name,
		alias,
		description: description ?? '',
		examples,
		fnName: exportName,
		params,
		isAsync: fn.isAsync(),
		argumentParams,
	};
}

// NOTE: Codegen helpers

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

function buildCommandBlock(c: CommandInfo): string {
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

function buildOutputFile(
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

export interface GenerateCliOptions {
	input: string;
	output: string;
	cwd?: string;
	checkOnly?: boolean;
}

export interface GenerateCliResult {
	commandCount: number;
	outputPath: string;
	wrote: boolean;
}

export function generate(options: GenerateCliOptions): GenerateCliResult {
	const cwd = options.cwd ?? process.cwd();
	const inputPath = path.resolve(cwd, options.input);
	const outputPath = path.resolve(cwd, options.output);

	if (!fs.existsSync(inputPath)) {
		throw new Error(`Input file not found at ${inputPath} (cwd: ${cwd})`);
	}

	if (!fs.statSync(inputPath).isFile()) {
		throw new Error(`Input path exists but is not a file: ${inputPath}`);
	}

	const project = new Project();
	const sourceFile = project.addSourceFileAtPath(inputPath);
	const exportedDecls = sourceFile.getExportedDeclarations();

	if (exportedDecls.size === 0) {
		throw new Error(
			`No exported declarations found in ${inputPath}. Use named re-exports, not export * from './y'.`,
		);
	}

	const commands: CommandInfo[] = [];
	for (const [exportName, decls] of exportedDecls) {
		const decl = decls[0];
		if (!decl || decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
		const fn = decl.asKindOrThrow(SyntaxKind.FunctionDeclaration);
		commands.push(extractCommandInfo(exportName, fn));
	}

	if (commands.length === 0) {
		throw new Error(
			'No documented function exports found. Nothing to generate.',
		);
	}

	if (options.checkOnly) {
		return { commandCount: commands.length, outputPath, wrote: false };
	}

	const outputContent = buildOutputFile(commands, inputPath, outputPath);

	const outputDir = path.dirname(outputPath);
	fs.mkdirSync(outputDir, { recursive: true });
	project.createSourceFile(outputPath, outputContent, { overwrite: true });
	project.saveSync();

	if (!fs.existsSync(outputPath)) {
		throw new Error(
			`Expected ${outputPath} to exist after saveSync(), but it doesn't.`,
		);
	}

	return { commandCount: commands.length, outputPath, wrote: true };
}
