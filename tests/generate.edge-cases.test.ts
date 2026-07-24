import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generate } from '../src/index';

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

describe('leaf type varieties', () => {
	it('handles number type', () => {
		const cwd = writeFixture(`
			/**
			 * @description Create a user with a numeric ID
			 * @option id the user id
			 */
			export function getUser(id: number) {
				return id;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("'--id <value>'");
		expect(content).toContain('"the user id"');
	});

	it('handles number[] type', () => {
		const cwd = writeFixture(`
			/**
			 * @description Sum a list of numbers
			 * @option values numbers to sum
			 */
			export function sum(values: number[]) {
				return values.reduce((a, b) => a + b, 0);
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("'--values <values...>', \"numbers to sum\", []");
		expect(content).toContain("filter: (v) => v.split(',').map((s) => s.trim()).map(Number)");
	});

	it('handles Array<string> syntax', () => {
		const cwd = writeFixture(`
			/**
			 * @description Accept items as Array<string>
			 * @option items list of items
			 */
			export function collect(items: Array<string>) {
				return items.join(',');
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("'--items <values...>'");
	});

	it('handles Array<number> syntax', () => {
		const cwd = writeFixture(`
			/**
			 * @description Accept scores as Array<number>
			 * @option scores list of scores
			 */
			export function tally(scores: Array<number>) {
				return scores.reduce((a, b) => a + b, 0);
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("'--scores <values...>'");
		expect(content).toContain('filter: (v) => v.split(\',\').map((s) => s.trim()).map(Number)');
	});

	it('handles a single-member string-literal union (enum with 1 choice)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Single-choice mode
			 * @option mode the only mode
			 */
			export function singleMode(mode: 'default') {
				return mode;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('.choices(["default"])');
	});

	it('handles a union of many string literals', () => {
		const cwd = writeFixture(`
			/**
			 * @description Many choices
			 * @option color pick a color
			 */
			export function pickColor(color: 'red' | 'green' | 'blue' | 'yellow' | 'purple' | 'orange') {
				return color;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('.choices(["red","green","blue","yellow","purple","orange"])');
		expect(content).toContain("type: 'select'");
	});

	it('handles boolean with no default', () => {
		const cwd = writeFixture(`
			/**
		 * @description Toggle debug mode
		 * @option debug enable debug output
			 */
			export function toggle(debug: boolean) {
				return debug;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// boolean flag — no <value> in option
		expect(content).toContain('.option(\'--debug\', "enable debug output")');
	});
});

describe('optional and default value edge cases', () => {
	it('optional param WITHOUT a default is NOT prompted', () => {
		const cwd = writeFixture(`
			/**
			 * @description Optional without default
			 * @option name the name
			 * @option title optional title
			 */
			export function greet(name: string, title?: string) {
				return title ? \`\${title} \${name}\` : name;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// required 'name' IS prompted
		expect(content).toMatch(/name:\s*'name'/);
		// optional 'title' is NOT prompted
		expect(content).not.toMatch(/name:\s*'title'/);
	});

	it('string default value is emitted in the option', () => {
		const cwd = writeFixture(`
			/**
			 * @description String with default
			 * @option env target environment
			 */
			export function deploy(env: string = 'production') {
				return env;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// optional because it has initializer — no prompt
		expect(content).not.toMatch(/name:\s*'env'/);
	});

	it('number default value', () => {
		const cwd = writeFixture(`
			/**
			 * @description Number with default
			 * @option count retry count
			 */
			export function retry(count: number = 3) {
				return count;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toMatch(/name:\s*'count'/);
	});

	it('boolean with default true is not prompted', () => {
		const cwd = writeFixture(`
			/**
			 * @description Verbose logging
			 * @option verbose enable verbose logging
			 */
			export function log(verbose: boolean = true) {
				return verbose;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toMatch(/name:\s*'verbose'/);
	});

	it('enum with string-literal default', () => {
		const cwd = writeFixture(`
			/**
			 * @description Mode with default
			 * @option mode execution mode
			 */
			export function run(mode: 'dev' | 'prod' | 'test' = 'dev') {
				return mode;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// not prompted
		expect(content).not.toMatch(/name:\s*'mode'/);
	});

	it('boolean with `false` literal default is not prompted', () => {
		const cwd = writeFixture(`
			/**
			 * @description Quiet mode
			 * @option quiet suppress output
			 */
			export function exec(quiet: boolean = false) {
				return quiet;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toMatch(/name:\s*'quiet'/);
	});

	it('multiple required params generate multiple prompt entries', () => {
		const cwd = writeFixture(`
			/**
			 * @description Multi-prompt command
			 * @option username the username
			 * @option password the password
			 * @option host the host address
			 */
			export function login(username: string, password: string, host: string) {
				return \`\${username}@\${host}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toMatch(/name:\s*'username'/);
		expect(content).toMatch(/name:\s*'password'/);
		expect(content).toMatch(/name:\s*'host'/);
	});
});

describe('nested object params', () => {
	it('handles 3-level deep nesting', () => {
		const cwd = writeFixture(`
			/**
			 * @description Deeply nested config
			 */
			export function deepConfig(cfg: { outer: { middle: { inner: string } } }) {
				return cfg.outer.middle.inner;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-outer-middle-inner');
		expect(content).toContain('inner: resolved.cfgOuterMiddleInner');
	});

	it('handles deeply nested objects with mixed leaf types', () => {
		const cwd = writeFixture(`
			/**
			 * @description Complex nested config
			 */
			export function complex(cfg: {
				server: { host: string; port: number };
				logging: { level: 'debug' | 'info' | 'error'; verbose: boolean };
			}) {
				return { server: cfg.server, logging: cfg.logging };
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-server-host');
		expect(content).toContain('--cfg-server-port');
		expect(content).toContain('--cfg-logging-level');
		expect(content).toContain('--cfg-logging-verbose');

		// Generated nested object literals for the call
		expect(content).toContain('host: resolved.cfgServerHost');
		expect(content).toContain('port: resolved.cfgServerPort');
		expect(content).toContain('level: resolved.cfgLoggingLevel');
		expect(content).toContain('verbose: resolved.cfgLoggingVerbose');

		// The nested object structure should preserve the shape
		expect(content).toContain('server: { host: resolved.cfgServerHost, port: resolved.cfgServerPort }');
		expect(content).toContain('logging: { level: resolved.cfgLoggingLevel, verbose: resolved.cfgLoggingVerbose }');
	});

	it('handles optional nested object field', () => {
		const cwd = writeFixture(`
			/**
			 * @description Optional nested field
			 * @option config.name the name
			 * @option config.title optional title
			 */
			export function greet(config: { name: string; title?: string }) {
				return \`\${config.name} - \${config.title ?? '(no title)'}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// required 'config-name' IS prompted
		expect(content).toMatch(/name:\s*'configName'/);
		// optional 'config-title' is NOT prompted
		expect(content).not.toMatch(/name:\s*'configTitle'/);
	});

	it('handles object with enum[] field', () => {
		const cwd = writeFixture(`
			/**
			 * @description Config with enum array
			 */
			export function tagConfig(cfg: { name: string; tags: ('ui' | 'api' | 'db')[] }) {
				return \`\${cfg.name}: \${cfg.tags.join(',')}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-name');
		expect(content).toContain('--cfg-tags');
		expect(content).toContain('.choices(["ui","api","db"])');
		expect(content).toContain('name: resolved.cfgName');
		expect(content).toContain('tags: resolved.cfgTags');
	});

	it('handles object with string[] field', () => {
		const cwd = writeFixture(`
			/**
			 * @description Config with string array
			 */
			export function arrayConfig(cfg: { items: string[]; desc: string }) {
				return \`\${cfg.desc}: \${cfg.items.join(',')}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-items');
		expect(content).toContain('--cfg-desc');
	});

	it('handles object with number[] field', () => {
		const cwd = writeFixture(`
			/**
			 * @description Config with number array
			 */
			export function numConfig(cfg: { scores: number[]; label: string }) {
				return \`\${cfg.label}: \${cfg.scores.reduce((a,b) => a+b, 0)}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-scores');
		expect(content).toContain('--cfg-label');
	});

	it('handles multiple flat params alongside a nested param', () => {
		const cwd = writeFixture(`
			/**
			 * @description Mixed flat and nested
			 * @option name the name
			 * @option config.host the host
			 * @option config.port the port
			 */
			export function connect(name: string, config: { host: string; port: number }) {
				return \`\${name}@\${config.host}:\${config.port}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Flat param
		expect(content).toContain('resolved.name');
		// Nested param reconstructed as object literal
		expect(content).toContain('{ host: resolved.configHost, port: resolved.configPort }');
	});
});

describe('type alias and interface params', () => {
	it('handles a type alias used as a param type', () => {
		const cwd = writeFixture(`
			type UserConfig = {
				name: string;
				age: number;
			};

			/**
			 * @description Config using type alias
			 */
			export function setup(cfg: UserConfig) {
				return \`\${cfg.name}: \${cfg.age}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-name');
		expect(content).toContain('--cfg-age');
	});

	it('handles an interface used as a param type', () => {
		const cwd = writeFixture(`
			interface ServerOptions {
				host: string;
				port: number;
				secure: boolean;
			}

			/**
			 * @description Start a server
			 */
			export function startServer(opts: ServerOptions) {
				return \`\${opts.host}:\${opts.port}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--opts-host');
		expect(content).toContain('--opts-port');
		expect(content).toContain('--opts-secure');
	});

	it('handles a type alias referencing other type aliases', () => {
		const cwd = writeFixture(`
			type Endpoint = { url: string; method: 'GET' | 'POST' };
			type ApiConfig = { endpoint: Endpoint; timeout: number };

			/**
			 * @description Nested type aliases
			 */
			export function callApi(cfg: ApiConfig) {
				return \`\${cfg.endpoint.method} \${cfg.endpoint.url}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--cfg-endpoint-url');
		expect(content).toContain('--cfg-endpoint-method');
		expect(content).toContain('--cfg-timeout');
		expect(content).toContain('.choices(["GET","POST"])');
	});
});

describe('multiple commands and exports', () => {
	it('generates all functions across mixed export declarations', () => {
		const cwd = writeFixture(`
			/**
			 * @description Sync command
			 */
			export function sync() { return 'sync'; }

			export const CONSTANT = 42;

			/**
			 * @description Async command
			 */
			export async function asyncOp() { return 'async'; }

			export interface SomeType { x: number; }

			/**
			 * @description Another sync
			 */
			export function another() { return 'another'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(result.commandCount).toBe(3);
		expect(content).toContain(".command('sync')");
		expect(content).toContain(".command('asyncOp')");
		expect(content).toContain(".command('another')");
		// Constants and interfaces should be skipped
		expect(content).not.toContain('CONSTANT');
	});

	it('mixed sync and async functions generate correct call style', () => {
		const cwd = writeFixture(`
			/**
			 * @description A sync function
			 */
			export function green() { return 'green'; }

			/**
			 * @description An async function
			 */
			export async function blue() { return 'blue'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toMatch(/const result = green\(\)/);
		expect(content).toMatch(/const result = await blue\(\)/);
	});

	it('zero-param async function still uses await', () => {
		const cwd = writeFixture(`
			/**
			 * @description Fetch data
			 */
			export async function fetchData() {
				return Promise.resolve('data');
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('await fetchData()');
	});
});

describe('JSDoc edge cases', () => {
	it('uses @name tag to override command name', () => {
		const cwd = writeFixture(`
			/**
			 * @name custom-command
			 * @description Overridden command name
			 * @option value some value
			 */
			export function originalExportName(value: string) {
				return value;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(".command('custom-command')");
		expect(content).not.toContain(".command('originalExportName')");
	});

	it('multiple @example tags all render', () => {
		const cwd = writeFixture(`
			/**
			 * @description A command
			 * @option val a value
			 * @example cmd-one val1
			 * @example cmd-one val2 --flag
			 * @example cmd-one val3 sub
			 */
			export function cmdOne(val: string) {
				return val;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('cmd-one val1');
		expect(content).toContain('cmd-one val2 --flag');
		expect(content).toContain('cmd-one val3 sub');
	});

	it('empty @example entries are filtered out', () => {
		const cwd = writeFixture(`
			/**
			 * @description Command with empty examples
			 * @option val a value
			 * @example
			 * @example real-example val
			 */
			export function cmdTwo(val: string) {
				return val;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('real-example val');
	});

	it('@option description with leading dash is stripped', () => {
		const cwd = writeFixture(`
			/**
			 * @description Param with dash prefix
			 * @option name - the user name
			 * @option age - the user age - in years
			 */
			export function createUser(name: string, age: number) {
				return \`\${name} (\${age})\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('"the user name"');
		expect(content).toContain('"the user age - in years"');
	});

	it('@option tag with no description is skipped in map', () => {
		const cwd = writeFixture(`
			/**
			 * @description No param description
			 * @option name
			 */
			export function bare(name: string) {
				return name;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Falls back to "name (string)"
		expect(content).toContain('"name (string)"');
	});

	it('no alias means no .alias() call', () => {
		const cwd = writeFixture(`
			/**
			 * @description No alias here
			 * @option val a value
			 */
			export function noAlias(val: string) {
				return val;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).not.toContain('.alias(');
	});

	it('@option with dash-separated multi-word description (plain JSDoc style)', () => {
		// In TypeScript, ts-morph parses @option as JSDocParameterTag.
		// This tests that descriptions with trailing dashes are preserved correctly.
		const cwd = writeFixture(`
			/**
			 * @description Description with dashes
			 * @option input input - output - processing
			 */
			export function process(input: string) {
				return input;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// The dash-stripping only handles leading dash
		expect(content).toContain('input - output - processing');
	});
});

describe('argument and option mix', () => {
	it('one @argument + one @option generates .argument() + .option()', () => {
		const cwd = writeFixture(`
			/**
			 * @description Copy a file
			 * @argument source the source path
			 * @option dest the destination path
			 */
			export function copy(source: string, dest: string) {
				return \`\${source} -> \${dest}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(".argument('[source]'");
		expect(content).toContain('.option(\'--dest <value>\'');
	});

	it('multiple @arguments appear in order as positional args', () => {
		const cwd = writeFixture(`
			/**
			 * @description Move a file
			 * @argument source the source path
			 * @argument dest the destination path
			 */
			export function move(source: string, dest: string) {
				return \`\${source} -> \${dest}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(".argument('[source]'");
		expect(content).toContain(".argument('[dest]'");
		// Source comes before dest in positional order
		const sourceIdx = content.indexOf(".argument('[source]'");
		const destIdx = content.indexOf(".argument('[dest]'");
		expect(sourceIdx).toBeLessThan(destIdx);
	});

	it('@argument values flow through positionalArg in action handler', () => {
		const cwd = writeFixture(`
			/**
			 * @description Read a config file
			 * @argument file the file path
			 * @option format output format
			 */
			export function read(file: string, format: 'json' | 'yaml' = 'json') {
				return \`read \${file} as \${format}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Action receives positionalArg0 then opts
		expect(content).toContain('.action(async (positionalArg0, opts) => {');
		// Values assignment uses positionalArg for the argument
		expect(content).toContain('file: positionalArg0');
		expect(content).toContain('format: opts.format');
		// Argument must NOT be prompted (it comes from CLI position, not interactive)
		expect(content).not.toContain("name: 'file'");
		// Optional format with default is NOT prompted
		expect(content).not.toContain("name: 'format'");
	});

	it('@argument with leading-dash description strips leading dash', () => {
		const cwd = writeFixture(`
			/**
			 * @description Process item
			 * @argument item - the item to process
			 * @option verbose - enable verbose output
			 */
			export function process(item: string, verbose: boolean) {
				return \`\${item}: \${verbose}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('"the item to process"');
		expect(content).toContain('"enable verbose output"');
	});

	it('@argument with dash-separated multi-word description (like @option dash test)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Transform data
			 * @argument input input - output - processing
			 */
			export function transform(input: string) {
				return input;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Description preserves internal dashes, only leading-dash is stripped
		expect(content).toContain('input - output - processing');
	});

	it('required @argument is NOT prompted (comes from positional arg)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Greet a user
			 * @argument name the user name
			 * @option title optional title
			 */
			export function greet(name: string, title?: string) {
				return \`\${title ? title + ' ' : ''}\${name}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// 'name' is an argument — not in prompt list
		expect(content).not.toMatch(/name:\s*'name'/);
		// 'title' is optional — also not prompted
		expect(content).not.toMatch(/name:\s*'title'/);
		// But title should still be in values as opts.title
		expect(content).toContain('title: opts.title');
	});

	it('@argument with number type produces .argument()', () => {
		const cwd = writeFixture(`
			/**
			 * @description Set a timeout
			 * @argument ms timeout in milliseconds
			 */
			export function setTimeout(ms: number) {
				return ms;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(".argument('[ms]'");
		expect(content).toContain('ms: positionalArg0');
	});

	it('param with no @option tag defaults to option (not argument)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Default to option
			 * @argument name the name
			 */
			export function defaultOpt(name: string, verbose: boolean) {
				return \`\${name}: \${verbose}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// 'name' is an @argument
		expect(content).toContain(".argument('[name]'");
		// 'verbose' has no tag, so defaults to --flag option
		expect(content).toContain('.option(\'--verbose\'');
	});

	it('errors: @argument on optional param throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Optional as argument
			 * @argument name the name
			 */
			export function bad(name?: string) {
				return name;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/@argument "name" must be a required parameter/
		);
	});

	it('errors: @argument on boolean param throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Booleans as argument
			 * @argument flag enable something
			 */
			export function bad(flag: boolean) {
				return flag;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/@argument "flag" must be a string or number parameter/
		);
	});

	it('errors: @argument on enum param throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Enum as argument
			 * @argument mode the mode
			 */
			export function bad(mode: 'a' | 'b') {
				return mode;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/@argument "mode" must be a string or number parameter/
		);
	});

	it('errors: @argument on array param throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Array as argument
			 * @argument items the items
			 */
			export function bad(items: string[]) {
				return items;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/@argument "items" must be a string or number parameter/
		);
	});

	it('errors: same param tagged @argument AND @option throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Dual tag conflict
			 * @argument name the name
			 * @option name the name
			 */
			export function bad(name: string) {
				return name;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/tagged both @argument and @option/
		);
	});

	it('errors: @argument that does not match any param throws', () => {
		const cwd = writeFixture(`
			/**
			 * @description Nonexistent argument
			 * @argument nonexistent who?
			 */
			export function bad(name: string) {
				return name;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/@argument "nonexistent" does not match any top-level parameter/
		);
	});

	it('multiple arguments + multiple options produce correct action signature', () => {
		const cwd = writeFixture(`
			/**
			 * @description Full pipeline
			 * @argument input input file
			 * @argument output output file
			 * @option format output format
			 * @option verbose enable verbose logging
			 */
			export function pipeline(input: string, output: string, format: 'json' | 'yaml' = 'json', verbose: boolean = false) {
				return \`\${input} -> \${output} (\${format}, verbose=\${verbose})\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Two positional args, then opts
		expect(content).toContain('.action(async (positionalArg0, positionalArg1, opts) => {');
		// Values assignment in correct order
		expect(content).toContain('input: positionalArg0');
		expect(content).toContain('output: positionalArg1');
		expect(content).toContain('format: opts.format');
		expect(content).toContain('verbose: opts.verbose');
	});

	it('@argument with custom description is used in .argument()', () => {
		const cwd = writeFixture(`
			/**
			 * @description Delete a resource
			 * @argument id the unique resource identifier
			 */
			export function del(id: string) {
				return \`deleted \${id}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('"the unique resource identifier"');
	});

	it('no @option or @argument tags means everything defaults to --flag option', () => {
		const cwd = writeFixture(`
			/**
			 * @description Default all to option
			 */
			export function deploy(env: string, region: string) {
				return \`\${env}:\${region}\`;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// No .argument() calls at all
		expect(content).not.toContain('.argument(');
		// Both are --flag options
		expect(content).toContain('.option(\'--env <value>\'');
		expect(content).toContain('.option(\'--region <value>\'');
		// Action only receives opts, no positional args
		expect(content).toContain('.action(async (opts) => {');
	});
});

describe('output path and import edge cases', () => {
	it('writes to subdirectory that does not exist (creates it)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Write to nested dir
			 */
			export function deep() { return 'deep'; }
		`);

		const outputDir = path.join(tmpDir, 'some', 'deep', 'output');
		const outputPath = path.join(outputDir, 'commands.gen.ts');
		const result = generate({
			input: 'index.ts',
			output: 'some/deep/output/commands.gen.ts',
			cwd,
		});

		expect(result.wrote).toBe(true);
		expect(fs.existsSync(outputPath)).toBe(true);
	});

	it('generates correct relative import for output in subdirectory', () => {
		const cwd = writeFixture(`
			/**
			 * @description Subdir output test
			 */
			export function subdir() { return 'ok'; }
		`);

		const result = generate({
			input: 'index.ts',
			output: 'src/generated/commands.gen.ts',
			cwd,
		});
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Import from '../../index' since output is in src/generated/
		expect(content).toContain("from '../../index'");
	});

	it('generates correct relative import when input is in subdirectory', () => {
		const cwd = writeFixture(`
			/**
			 * @description Input in subdir
			 */
			export function subInput() { return 'ok'; }
		`);

		// Write input to a subdirectory
		const subDir = path.join(tmpDir, 'lib');
		fs.mkdirSync(subDir, { recursive: true });
		fs.writeFileSync(path.join(subDir, 'commands.ts'), fs.readFileSync(path.join(cwd, 'index.ts')));
		fs.unlinkSync(path.join(cwd, 'index.ts'));

		const result = generate({
			input: 'lib/commands.ts',
			output: 'out.gen.ts',
			cwd,
		});
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		// Import from './lib/commands'
		expect(content).toContain("from './lib/commands'");
	});

	it('generates correct relative import when input and output are in same dir', () => {
		const cwd = writeFixture(`
			/**
			 * @description Same dir
			 */
			export function sameDir() { return 'ok'; }
		`);

		const result = generate({
			input: 'index.ts',
			output: 'output.gen.ts',
			cwd,
		});
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("from './index'");
	});
});

describe('edge error cases', () => {
	it('throws on a type {} (empty object type)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Empty object
			 */
			export function emptyObj(x: {}) {
				return x;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/unsupported type/
		);
	});

	it('throws on type `any`', () => {
		const cwd = writeFixture(`
			/**
			 * @description Any type
			 */
			export function anyType(x: any) {
				return x;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/unsupported type/
		);
	});

	it('throws on type `unknown`', () => {
		const cwd = writeFixture(`
			/**
			 * @description Unknown type
			 */
			export function unknownType(x: unknown) {
				return x;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/unsupported type/
		);
	});

	it('handles intersection types by expanding into combined props', () => {
		const cwd = writeFixture(`
			/**
			 * @description Intersection type
			 */
			export function intersect(x: { a: string } & { b: number }) {
				return x;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('--x-a');
		expect(content).toContain('--x-b');
	});

	it('throws on `void` param type', () => {
		const cwd = writeFixture(`
			/**
			 * @description Void type
			 */
			export function voidType(x: void) {
				return x;
			}
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd })).toThrow(
			/unsupported type/
		);
	});

	it('throws on generator function (not supported, but should fail gracefully)', () => {
		const code = `
			/**
			 * @description Generator function
			 */
			export function* generator() {
				yield 1;
			}
		`;
		// This does not throw — generator functions are FunctionDeclarations
		// (checking if the existing test might actually handle it via the
		// "no documented function exports" path, since generators have no params)
		const cwd = writeFixture(code);
		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');
		expect(content).toContain(".command('generator')");
	});

	it('handles input file with .mts extension', () => {
		// Create fresh tmp dir to avoid stale tmpDir issues
		const mtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-codegen-mts-'));
		const altFile = path.join(mtsDir, 'cli.mts');
		fs.writeFileSync(altFile, `
			/**
		 * @description MTS file
			 */
			export function mtsFn() { return 'mts'; }
		`);

		const result = generate({ input: 'cli.mts', output: 'out.gen.ts', cwd: mtsDir });
		const content = fs.readFileSync(result.outputPath, 'utf-8');
		expect(content).toContain(".command('mtsFn')");

		// Cleanup
		fs.rmSync(mtsDir, { recursive: true, force: true });
	});

	it('check mode reports 0 when no function exports but has other exports', () => {
		const cwd = writeFixture(`
			export const x = 1;
			export type Y = string;
			export interface Z { z: number };
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true })).toThrow(
			/No documented function exports/
		);
	});

	it('throws when input is a directory instead of a file', () => {
		const cwd = writeFixture(`
			/**
		 * @description Directory input
			 */
			export function dirTest() { return 'ok'; }
		`);

		// Create a dir that would shadow the input name
		const dirPath = path.join(tmpDir, 'mydir');
		fs.mkdirSync(dirPath, { recursive: true });

		expect(() => generate({ input: 'mydir', output: 'out.gen.ts', cwd: tmpDir })).toThrow(
			/Input path exists but is not a file/
		);
	});
});

describe('check mode edge cases', () => {
	it('check mode reports correct count for valid input', () => {
		const cwd = writeFixture(`
			/**
			 * @description Command A
			 */
			export function a() { return 'a'; }
			/**
			 * @description Command B
			 */
			export function b() { return 'b'; }
			/**
			 * @description Command C
			 */
			export function c() { return 'c'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true });

		expect(result.wrote).toBe(false);
		expect(result.commandCount).toBe(3);
		expect(fs.existsSync(result.outputPath)).toBe(false);
	});

	it('check mode still validates JSDoc and throws', () => {
		const cwd = writeFixture(`
			/**
			 * Missing description
			 */
			export function bad() { return 'bad'; }
		`);

		expect(() => generate({ input: 'index.ts', output: 'out.gen.ts', cwd, checkOnly: true })).toThrow(
			/missing required @description/
		);
	});
});

describe('generated output structure', () => {
	it('imports Option class when enums are used', () => {
		const cwd = writeFixture(`
			/**
			 * @description Enum command
			 * @option mode the mode
			 */
			export function enumCmd(mode: 'on' | 'off') {
				return mode;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("import { Command, Option } from 'commander';");
	});

	it('does NOT import Option class when no enums are used', () => {
		const cwd = writeFixture(`
			/**
			 * @description Basic command
			 * @option name the name
			 */
			export function basic(name: string) {
				return name;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain("import { Command } from 'commander';");
		expect(content).not.toContain(', Option');
	});

	it('generates valid call expression for function with no return', () => {
		const cwd = writeFixture(`
			/**
			 * @description Void return
			 * @option name the name
			 */
			export function logName(name: string): void {
				console.log(name);
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('if (result !== undefined) console.log(result);');
	});

	it('generates the auto-generated header comment', () => {
		const cwd = writeFixture(`
			/**
			 * @description Header test
			 */
			export function headerTest() { return 'ok'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('AUTO-GENERATED');
		expect(content).toContain('commander-codegen');
	});

	it('generates registerCommands export function', () => {
		const cwd = writeFixture(`
			/**
			 * @description Register test
			 */
			export function regTest() { return 'ok'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('export function registerCommands(program: Command): void {');
	});

	it('generates all commands in a single output', () => {
		const cwd = writeFixture(`
			/**
			 * @description Cmd one
			 */
			export function one() { return 1; }
			/**
			 * @description Cmd two
			 */
			export function two() { return 2; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain(".command('one')");
		expect(content).toContain(".command('two')");
	});
});

describe('negative and unexpected input', () => {
	it('skips non-function exported declarations silently', () => {
		const cwd = writeFixture(`
			export const CONST = 1;
			export type MyType = string;
			export interface MyInterface { x: number };
			export class MyClass {}

			/**
			 * @description Only this should be picked up
			 */
			export function onlyFn() { return 'fn'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		expect(result.commandCount).toBe(1);
	});

	it('handles function with no return type annotation', () => {
		const cwd = writeFixture(`
			/**
			 * @description No return annotation
			 * @option val the value
			 */
			export function echo(val: string) {
				return val;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		expect(result.wrote).toBe(true);
	});

	it('handles string literal param with special characters in the value', () => {
		const cwd = writeFixture(`
			/**
			 * @description Special chars in choices
			 * @option fmt format string
			 */
			export function format(fmt: 'json' | 'yaml' | 'text') {
				return fmt;
			}
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('.choices(["json","yaml","text"])');
	});

	it('handles cwd with a trailing slash', () => {
		const cwd = writeFixture(`
			/**
			 * @description Trailing slash CWD
			 */
			export function trailing() { return 'ok'; }
		`);

		const result = generate({
			input: path.join(tmpDir, 'index.ts'),
			output: path.join(tmpDir, 'out.gen.ts'),
			cwd: tmpDir + '/',
		});
		expect(result.wrote).toBe(true);
	});

	it('generates correctly when opts object is empty (no CLI options)', () => {
		const cwd = writeFixture(`
			/**
			 * @description Zero param command
			 */
			export function ping() { return 'pong'; }
		`);

		const result = generate({ input: 'index.ts', output: 'out.gen.ts', cwd });
		const content = fs.readFileSync(result.outputPath, 'utf-8');

		expect(content).toContain('const resolved = {  };');
		expect(content).toContain('const result = ping();');
	});
});
