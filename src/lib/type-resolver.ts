import type { Type } from 'ts-morph';
import { fail } from './jsdoc-helpers';
import type { ParamInfo, ParamKind } from './types';

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

/**
 * Expand a TypeScript type into a flat list of ParamInfo, handling nested
 * objects, unions, arrays, and optionality.
 */
export function expandParam(
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
