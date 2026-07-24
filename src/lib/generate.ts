import fs from 'node:fs';
import path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import { buildOutputFile } from './codegen';
import { extractCommandInfo } from './extract-command';
import type { GenerateCliOptions, GenerateCliResult } from './types';

export type { GenerateCliOptions, GenerateCliResult } from './types';

/**
 * Generate a Commander CLI file from a documented TypeScript entry file.
 *
 * Reads every exported function in the input file, inspects its JSDoc tags
 * and TypeScript parameter types, and writes a complete Commander command
 * registration file to the output path.
 */
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

	const commands = [];
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
