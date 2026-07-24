import type { FunctionDeclaration } from 'ts-morph';
import {
	fail,
	getAllTagTexts,
	getArgOrOptionTagMap,
	getTagText,
} from './jsdoc-helpers';
import { expandParam } from './type-resolver';
import type { CommandInfo } from './types';

/**
 * Extract a CommandInfo from a function declaration by inspecting its JSDoc
 * tags and TypeScript parameter types.
 */
export function extractCommandInfo(
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

	const params = fnParams.flatMap((p) => {
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
