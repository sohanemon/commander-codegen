# commander-codegen

Generate a fully-featured [Commander](https://github.com/tj/commander.js) CLI from plain, documented TypeScript functions. Write a function once, export it, add a couple of TSDoc tags, and get a CLI command with flags, validated choices, and interactive prompts for anything left unsupplied, with zero hand-written Commander code.

Your functions stay ordinary exports the whole time. Nothing about them is CLI-specific, they're just as usable as a normal library import as they are as a CLI command.

```ts
/**
 * @description Set the log level
 * @param level the log level
 */
export function setLevel(level: 'debug' | 'info' | 'error') {
	return `level set to ${level}`;
}
```

```sh
commander-codegen
```

```sh
mycli set-level --level debug
# or, if --level is omitted:
mycli set-level
# ? level  (Use arrow keys)
# ❯ debug
#   info
#   error
```

## Install

```sh
bun add -D commander-codegen commander inquirer
# or
npm install -D commander-codegen commander inquirer
```

`commander` and `inquirer` are peer dependencies, the code this tool generates imports them directly, so they need to exist in your project.

## Usage

```sh
commander-codegen [options]

Options:
  -i, --input <path>     Entry file with documented exports (default: "src/index.ts")
  -o, --output <path>    Generated commander file (default: "src/lib/generated/commands.gen.ts")
  -c, --check            Validate only, don't write output (exit 1 on error)
  --cwd <path>           Run as if invoked from this directory (default: process.cwd())
```

```sh
# Use defaults
commander-codegen

# Custom paths
commander-codegen -i src/lib/commands.ts -o src/cli/generated.ts

# CI-friendly validation, fails the build if anything is undocumented
# or uses an unsupported type, without touching the output file
commander-codegen --check
```

Wire it into your build:

```json
{
	"scripts": {
		"generate:cli": "commander-codegen",
		"prebuild": "bun run generate:cli",
		"build": "tsdown"
	}
}
```

## As a library

`generate()` is also directly importable, for build scripts, plugins, or anything that wants programmatic control instead of shelling out:

```ts
import { generate } from 'commander-codegen';

const result = generate({
	input: 'src/index.ts',
	output: 'src/lib/generated/commands.gen.ts',
	checkOnly: false,
});

console.log(`Generated ${result.commandCount} command(s) at ${result.outputPath}`);
```

```ts
export interface GenerateCliOptions {
	input: string;
	output: string;
	cwd?: string;       // defaults to process.cwd()
	checkOnly?: boolean; // validate without writing, default false
}

export interface GenerateCliResult {
	commandCount: number;
	outputPath: string;
	wrote: boolean; // false when checkOnly is true
}
```

## Writing a command

Every function exported from your entry file becomes a command. `@description` is the only required tag, everything else has a sensible fallback.

```ts
/**
 * @name custom-command-name     // optional, defaults to the export name
 * @alias c                       // optional, short alias
 * @description What this does   // REQUIRED
 * @param paramName description   // optional, shown in --help; falls back to "name (type)"
 * @example my-command --flag x   // optional, repeatable, shown under --help
 */
export function myCommand(/* ... */) {}
```

### Supported parameter types

| TS type | CLI flag | Prompt when required and missing |
|---|---|---|
| `string` | `--flag <value>` | text input |
| `number` | `--flag <value>` | text input, coerced to number |
| `boolean` | `--flag` | confirm (y/n) |
| `string[]` / `number[]` | `--flag <values...>` (repeatable) | comma-separated input |
| `'a' \| 'b' \| 'c'` | `--flag <value>`, validated against choices | select (single choice) |
| `('a' \| 'b' \| 'c')[]` | `--flag <values...>`, validated against choices | checkbox (multi-select) |
| `{ a: string; b: number }` | flattened to `--parent-a`, `--parent-b`, recursively for nested objects | one prompt per leaf field |

Every parameter is generated as a flag, never a positional argument. This is deliberate: it's what allows a missing **required** value to fall back to an interactive prompt instead of Commander hard-failing before your function ever runs. Optional parameters, with or without a default, are never prompted for; they just pass through as-is.

Nested object parameters document their fields with a dotted `@param` path:

```ts
/**
 * @description Configure a service
 * @param config.name service name
 * @param config.mode service mode
 */
export function configureService(config: { name: string; mode: 'active' | 'standby' }) {
	return `${config.name}:${config.mode}`;
}
```

```sh
mycli configure-service --config-name api --config-mode active
```

### Async functions

Detected automatically, the generated `.action()` and function call are only marked `async`/`await` when the source function actually is, so sync functions don't generate pointless `await` on non-promises.

```ts
/**
 * @description Deploy asynchronously
 * @param env target environment
 */
export async function deployAsync(env: 'staging' | 'prod') {
	return fetch(`/deploy/${env}`);
}
```

## What's not supported

The generator throws a clear error naming the exact parameter and reason, rather than silently generating something broken:

- **Arrays of objects** (`{ id: string }[]`), no clean single-flag CLI representation. Write this command by hand instead.
- **Unions of non-string-literals** (`string | number`), only unions where every member is a string literal (`'a' | 'b'`) are supported.
- **Function/callback parameters, `Date`, and other non-primitive types**, same reasoning as above.
- **Missing `@description`**, every command needs one; there's no source to infer it from.

For anything on this list, hand-write that one command directly against Commander and register it alongside the generated ones. The generator only owns commands it can build safely.

## Example output

Given:

```ts
/**
 * @alias g
 * @description Greet someone by name
 * @param shout lets shout out
 */
export function greet(name: string, shout?: boolean) {
	const msg = `Hello, ${name}!`;
	return shout ? msg.toUpperCase() : msg;
}
```

Generates (`src/lib/generated/commands.gen.ts`):

```ts
// AUTO-GENERATED, do not edit by hand. Run `commander-codegen` to regenerate.
import { Command } from 'commander';
import inquirer from 'inquirer';
import { greet } from '../../index';

export function registerCommands(program: Command): void {
  program
    .command('greet')
    .alias('g')
    .description('Greet someone by name')
    .option('--name <value>', 'name (string)')
    .option('--shout', 'lets shout out')
    .action(async (opts) => {
      const missingQuestions = [
        { type: 'input', name: 'name', message: 'name (string)' }
      ].filter((q) => (opts as Record<string, unknown>)[q.name] === undefined);
      const answers = missingQuestions.length > 0 ? await inquirer.prompt(missingQuestions) : {};
      const resolved = { name: opts.name, shout: opts.shout, ...answers };
      const result = greet(resolved.name, resolved.shout);
      if (result !== undefined) console.log(result);
    });
}
```

Wire the generated file into your CLI entry point:

```ts
#!/usr/bin/env bun
import { Command } from 'commander';
import { registerCommands } from './lib/generated/commands.gen';

const program = new Command();
registerCommands(program);
await program.parseAsync(process.argv);
```

This file is regenerated on every run, don't hand-edit it, and don't commit manual changes to it; treat it like any other build artifact.


