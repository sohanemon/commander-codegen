# commander-codegen

Generate a fully-featured [Commander](https://github.com/tj/commander.js) CLI from plain, documented TypeScript functions. Write a function once, export it, add a couple of TSDoc tags, and get a CLI command with flags, validated choices, interactive prompts for anything left unsupplied, and optional positional arguments — with zero hand-written Commander code.

Your functions stay ordinary exports the whole time. Nothing about them is CLI-specific, they're just as usable as a normal library import as they are as a CLI command.

```ts
/**
 * @description Set the log level
 * @option level the log level
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

`commander` and `inquirer` are peer dependencies — the generated code imports them directly, so they need to exist in your project.

## AI skill file

[`SKILL.md`](./SKILL.md) provides a structured prompt that teaches AI coding assistants (pi, Claude Code, Cursor, Copilot, etc.) how to use commander-codegen correctly — what tags to add, which types are supported, when to use `@argument` vs `@option`, and what the generator can't handle. Share or symlink it into your AI agent's skills directory so it knows the tool without being prompted each time.

Raw URL: `https://github.com/sohanemon/commander-codegen/raw/main/SKILL.md`

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
 * @name custom-command-name           // optional, defaults to the export name
 * @alias c                             // optional, short alias
 * @description What this does          // REQUIRED
 * @option paramName description        // optional, marks param as --flag, shown in help
 * @argument paramName description      // optional, marks param as positional argument
 * @example my-command --flag x         // optional, repeatable, shown under --help
 */
export function myCommand(/* ... */) {}
```

### Parameters default to flags

Every parameter defaults to a `--flag` CLI option. This is deliberate: it allows a missing **required** value to fall back to an interactive prompt instead of Commander hard-failing before your function ever runs. Optional parameters, with or without a default, are never prompted for; they just pass through as-is.

### Positional arguments with `@argument`

Use the `@argument` tag to promote one or more parameters to positional arguments instead of flags. This is useful for required "subject" parameters (file paths, names, IDs) where a flag feels awkward.

```ts
/**
 * @description Copy a file to a destination
 * @argument source the source file path
 * @option dest the destination directory
 */
export function copy(source: string, dest: string) {
	return `${source} -> ${dest}`;
}
```

```sh
mycli copy ./input.txt --dest ./output/
```

Rules for `@argument`:

- Must be a **required** parameter (no `?` or default). Optional params can't be positional — they'd need a flag to know they were passed.
- Must be `string` or `number`. Enums, booleans, and arrays can't be positional.
- Tagging the same parameter with both `@argument` and `@option` is an error.
- Parameters with no tag at all default to `@option` (flag) behavior.
- Positional arguments are **not** prompted interactively (since Commander passes them through when omitted), so `@argument` is best for truly required values.

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

### Nested objects

Nested object parameters document their fields with a dotted `@option` path:

```ts
/**
 * @description Configure a service
 * @option config.name service name
 * @option config.mode service mode
 */
export function configureService(config: { name: string; mode: 'active' | 'standby' }) {
	return `${config.name}:${config.mode}`;
}
```

```sh
mycli configure-service --config-name api --config-mode active
```

### Async functions

Detected automatically. The generated `.action()` and function call are only marked `async`/`await` when the source function actually is, so sync functions don't generate pointless `await` on non-promises.

```ts
/**
 * @description Deploy asynchronously
 * @option env target environment
 */
export async function deployAsync(env: 'staging' | 'prod') {
	return fetch(`/deploy/${env}`);
}
```

### Multiple positional arguments

You can use multiple `@argument` tags. They appear as positional arguments in declaration order with the generated `.argument()` calls matching the order of `@argument` tags in your JSDoc:

```ts
/**
 * @description Move a file
 * @argument source the source path
 * @argument dest the destination path
 */
export function move(source: string, dest: string) {
	return `${source} -> ${dest}`;
}
```

```sh
mycli move ./in.txt ./out/
```

## What's not supported

The generator throws a clear error naming the exact parameter and reason, rather than silently generating something broken:

- **Arrays of objects** (`{ id: string }[]`), no clean single-flag CLI representation. Write this command by hand.
- **Unions of non-string-literals** (`string | number`), only unions where every member is a string literal (`'a' | 'b'`) are supported.
- **Function/callback parameters, `Date`, and other non-primitive types**, same reasoning as above.
- **Missing `@description`**, every command needs one; there's no source to infer it from.
- **`@argument` on an optional, boolean, enum, or array parameter** — only required `string`/`number` params can be positional.

For anything on this list, hand-write that one command directly against Commander and register it alongside the generated ones. The generator only owns commands it can build safely.

## Example output

Given:

```ts
/**
 * @alias g
 * @description Greet someone by name
 * @argument name the person to greet
 * @option shout lets shout out
 */
export function greet(name: string, shout?: boolean) {
	const msg = `Hello, ${name}!`;
	return shout ? msg.toUpperCase() : msg;
}
```

Generates (`src/lib/generated/commands.gen.ts`):

```ts
// AUTO-GENERATED — do not edit by hand. Run `commander-codegen` to regenerate.
import { Command } from 'commander';
import inquirer from 'inquirer';
import { greet } from '../../index';

export function registerCommands(program: Command): void {
  program
    .command('greet')
    .alias('g')
    .description('Greet someone by name')
    .argument('[name]', 'the person to greet')
    .option('--shout', 'lets shout out')
    .action(async (positionalArg0, opts) => {
      const values = { name: positionalArg0, shout: opts.shout };
      const resolved = { ...values };
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

This file is regenerated on every run — don't hand-edit it, treat it like any other build artifact.

## Project structure

```
src/
  lib/
    types.ts            — ParamInfo, CommandInfo, GenerateCliOptions, GenerateCliResult
    jsdoc-helpers.ts    — TSDoc tag extraction, @argument/@option tag map
    type-resolver.ts    — TS type → ParamKind resolution, nested object expansion
    extract-command.ts  — FunctionDeclaration → CommandInfo (orchestrates above)
    codegen.ts          — CommandInfo → Commander code string (options, arguments, prompts)
    generate.ts         — Top-level generate() orchestrator, entry point
  cli.ts                — CLI binary entry point
  index.ts              — Public API re-exports
```
