import { type JSDoc, JSDocParameterTag } from 'ts-morph';

// NOTE: Throw with export name for traceability

export function fail(exportName: string, message: string): never {
	throw new Error(`[generate] "${exportName}": ${message}`);
}

// NOTE: TSDoc extraction helpers

export function getTagText(
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

export function getAllTagTexts(
	jsDoc: JSDoc | undefined,
	tagName: string,
): string[] {
	return (
		jsDoc
			?.getTags()
			.filter((t) => t.getTagName() === tagName)
			.map((t) => t.getComment()?.toString().trim() ?? '')
			.filter((text) => text.length > 0) ?? []
	);
}

/**
 * Given raw text from a JSDoc tag comment, extract the first word as the
 * name and the rest as description. Handles a leading "- " prefix as a
 * JSDoc convention that should be stripped from the description.
 *
 * @example "name - description" -> { name: "name", description: "description" }
 * @example "input input - output - processing" -> { name: "input", description: "input - output - processing" }
 */
export function parseNameDescriptionTag(raw: string): {
	name: string;
	description: string;
} {
	const [firstWord, ...restWords] = raw.split(/\s+/);
	const name = firstWord ?? '';
	const rest = restWords.join(' ');

	// Handle optional "- " prefix in the description (a JSDoc convention)
	if (rest.startsWith('- ')) {
		return { name, description: rest.slice(2).trim() };
	}

	return { name, description: rest.trim() };
}

/**
 * Build a map of param name → description from @argument or @option tags.
 *
 * ts-morph parses @argument as JSDocParameterTag (name extracted separately),
 * but @option as a plain JSDocTag (name + description in one comment string).
 */
export function getArgOrOptionTagMap(
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
