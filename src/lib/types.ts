// NOTE: Param type definitions

export type ParamKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'string[]'
	| 'number[]'
	| 'enum'
	| 'enum[]';

export interface ParamInfo {
	path: string[];
	kind: ParamKind;
	optional: boolean;
	defaultValue: string | undefined;
	description: string;
	choices?: string[];
}

export interface CommandInfo {
	name: string;
	alias: string | undefined;
	description: string;
	examples: string[];
	fnName: string;
	params: ParamInfo[];
	isAsync: boolean;
	argumentParams: string[]; // top-level param names tagged @argument, in declaration order
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
