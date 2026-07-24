import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {  generate } from '../src/index';

let tmpDir: string;

function writeFixture(content: string): string {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-codegen-'));
	fs.writeFileSync(path.join(tmpDir, 'index.ts'), content);
	return tmpDir;
}

afterEach(() => {
	if (tmpDir && fs.existsSync(tmpDir)) {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

describe('generateCli — valid input', () => {
	it('generates a boolean flag with no default', () => {
		const cwd = writeFixture(`
			/**
			 * @alias g
			 * @description Greet someone by name
			 * @option shout lets shout out
			 */
			export function greet(name: string, shout?: boolean) {
				return shout ? name.toUpperCase() : name;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(`.option('--shout', "lets shout out")`);
		expect(content).toMatch(/\.command\('greet'\)\s*\n\s*\.alias\('g'\)/);
	});

	it('generates choices() for a required enum param', () => {
		const cwd = writeFixture(`
			/**
			 * @description Set the log level
			 * @option level the log level
			 */
			export function setLevel(level: 'debug' | 'info' | 'error') {
				return level;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(`.choices(["debug","info","error"])`);
	});

	it('generates checkbox prompting for enum[]', () => {
		const cwd = writeFixture(`
			/**
			 * @description Enable feature tags
			 * @option tags feature tags to enable
			 */
			export function enableTags(tags: ('api' | 'db' | 'cache')[]) {
				return tags.join(',');
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--tags <values...>');
		expect(content).toContain(`type: 'checkbox'`);
	});

	it('excludes an optional param with a default from the prompt list', () => {
		const cwd = writeFixture(`
			/**
			 * @description Run the build
			 * @option name build target name
			 * @option mode build mode
			 * @option verbose print extra output
			 */
			export function build(name: string, mode: 'dev' | 'prod', verbose: boolean = false) {
				return \`\${name}:\${mode}:\${verbose}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toMatch(/name:\s*'verbose'/);
		expect(content).toMatch(/name:\s*'name'/);
		expect(content).toMatch(/name:\s*'mode'/);
	});

	it('flattens nested object params into dashed flags', () => {
		const cwd = writeFixture(`
			/**
			 * @description Configure a service
			 * @option config.name service name
			 * @option config.mode service mode
			 */
			export function configureService(config: { name: string; mode: 'active' | 'standby' }) {
				return \`\${config.name}:\${config.mode}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--config-name');
		expect(content).toContain('--config-mode');
		expect(content).toContain('{ name: resolved.configName, mode: resolved.configMode }');
	});

	it('marks async functions with async action + await', () => {
		const cwd = writeFixture(`
			/**
			 * @description Deploy asynchronously
			 * @option env target environment
			 */
			export async function deployAsync(env: 'staging' | 'prod') {
				return Promise.resolve(\`deployed to \${env}\`);
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('.action(async (opts) => {');
		expect(content).toContain('await deployAsync(');
	});

	it('falls back to "name (kind)" when no @option tag exists', () => {
		const cwd = writeFixture(`
			/**
			 * @description Undocumented params fallback test
			 */
			export function undocumented(name: string, active?: boolean) {
				return \`\${name}:\${active}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('"name (string)"');
		expect(content).toContain('"active (boolean)"');
	});

	it('renders @example tags via addHelpText', () => {
		const cwd = writeFixture(`
			/**
			 * @description Command with examples
			 * @option name target name
			 * @example greet-multi Alice --loud
			 * @example greet-multi Bob
			 */
			export function greetMulti(name: string, loud?: boolean) {
				return loud ? name.toUpperCase() : name;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(`addHelpText('after'`);
		expect(content).toContain('greet-multi Alice --loud');
	});

	it('generates no prompt block for a zero-param command', () => {
		const cwd = writeFixture(`
			/**
			 * @description Run with zero arguments
			 */
			export function ping() {
				return 'pong';
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toContain('missingQuestions');
	});

	it('check mode reports the command count without writing a file', () => {
		const cwd = writeFixture(`
			/**
			 * @description A
			 */
			export function a() { return 1; }
			/**
			 * @description B
			 */
			export function b() { return 2; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true });

		expect(result.wrote).toBe(false);
		expect(result.commandCount).toBe(2);
		expect(fs.existsSync(result.outputPath)).toBe(false);
	});
});

describe('generateCli — invalid input', () => {
	it('throws when @description is missing', () => {
		const cwd = writeFixture(`
			/**
			 * @option level the level
			 */
			export function badNoDescription(level: 'a' | 'b') {
				return level;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true })).toThrow(
			/missing required @description tag/
		);
	});

	it('throws on an array of objects', () => {
		const cwd = writeFixture(`
			/**
			 * @description Bad array of objects
			 */
			export function badObjArray(items: { id: string }[]) {
				return items.length;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true })).toThrow(
			/array of non-primitive items/
		);
	});

	it('throws on a mixed (non-string-literal) union', () => {
	const cwd = writeFixture(`
		/**
		 * @description Bad mixed union
		 */
		export function badMixedUnion(value: string | number) {
			return value;
		}
	`);

	expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true })).toThrow(
		/unsupported union type/
	);
});

	it('throws when the input file does not exist', () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-codegen-empty-'));
		tmpDir = cwd;

		expect(() => generate({ input: 'does-not-exist.ts', output: 'out.gen.ts', cwd })).toThrow(
			/Input file not found/
		);
	});

	it('throws when there are no documented exports at all', () => {
		const cwd = writeFixture(`export const x = 1;`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/No exported declarations found|No documented function exports found/
		);
	});
});
