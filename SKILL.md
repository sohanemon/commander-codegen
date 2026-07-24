---
name: commander-codegen
description: Generates a fully-featured Commander CLI from plain, documented TypeScript function exports. Use this skill whenever a TypeScript project needs both a library API and a CLI from the same source, when adding a new CLI command to a project that already uses commander-codegen, or when deciding whether a given function can be exposed as a CLI command without hand-written Commander code.
---

# commander-codegen

## What it does

`commander-codegen` reads a TypeScript entry file (typically `src/index.ts`), inspects every exported function's signature and TSDoc comments, and generates a complete Commander.js CLI file from that alone. No Commander code is hand-written for any function it can handle. The same exported function remains fully usable as a normal library import — the CLI is a generated layer on top, not a fork of the logic.

This means a project only has to maintain one implementation of a piece of logic. The function is the single source of truth for: what it does (return value), how it's invoked as a library call, and how it's invoked as a CLI command (flags, arguments, validation, help text, interactive prompts).

## Core capability: type-driven CLI generation

The generator inspects each exported function's real TypeScript types (via `ts-morph`, not string parsing) and maps them to Commander constructs:

| TypeScript type | Generated CLI behavior | Interactive prompt (if required and missing) |
|---|---|---|
| `string` | `--flag <value>` | text input |
| `number` | `--flag <value>` | text input, coerced to number |
| `boolean` | `--flag` | confirm (y/n) |
| `string[]` / `number[]` | `--flag <values...>` (repeatable) | comma-separated input |
| `'a' \| 'b' \| 'c'` (string-literal union) | `--flag <value>`, validated against choices | select (single choice) |
| `('a' \| 'b' \| 'c')[]` (array of string-literal union) | `--flag <values...>`, validated against choices | checkbox (multi-select) |
| `{ a: string; b: number }` (flat or nested object) | flattened recursively to `--parent-a`, `--parent-b`, etc. | one prompt per leaf field |

## Core capability: automatic interactive fallback

Every parameter defaults to a CLI option (`--flag`), never a positional argument. This is deliberate: Commander does not hard-fail on a missing option the way it does on a missing positional argument, so the generated `.action()` handler gets a chance to run even when required values are absent.

When a required parameter's value is `undefined` after parsing CLI flags, the generated code automatically prompts for it via Inquirer, using a prompt type matched to that parameter's kind. This is the default behavior for every generated command, with zero configuration and no opt-in tag.

Optional parameters, with or without a default value, are never prompted for. They pass through as-is (using their default, or `undefined`). This preserves normal scriptable behavior: a command with all required values supplied on the command line runs immediately with no prompts, making it CI/automation-safe. Only when something required is missing does it become interactive.

```sh
mycli set-level --level debug        # non-interactive, scriptable
mycli set-level                       # interactive, prompts with a select menu
```

## Core capability: positional arguments with `@argument`

Use `@argument` to promote a required `string` or `number` parameter to a positional CLI argument instead of a `--flag`:

```ts
/**
 * @description Copy a file
 * @argument source the source path
 * @option dest the destination path
 */
export function copy(source: string, dest: string) {
  return `${source} -> ${dest}`;
}
```

```sh
mycli copy ./input.txt --dest ./out/
```

Rules:
- Must be a **required** parameter (no `?` or default).
- Must be `string` or `number` — enums, booleans, and arrays can't be positional.
- The same parameter cannot be tagged both `@argument` and `@option`.
- Parameters with no tag default to `@option` (flag) behavior.
- Positional arguments are **not** prompted interactively, since Commander silently passes them as `undefined` when omitted, unlike flags which get a second chance via Inquirer.

Multiple `@argument` tags are supported and appear as positional arguments in their JSDoc declaration order.

## Core capability: nested object flattening

Object parameters, including nested ones, are recursively flattened into individual dashed CLI flags, with camelCase accessor names reconstructed back into the original nested shape before the underlying function is called.

```ts
export function configureService(config: { name: string; mode: 'active' | 'standby' }) {
  return `${config.name}:${config.mode}`;
}
```

generates `--config-name` and `--config-mode`, and reconstructs `{ name: ..., mode: ... }` internally before calling `configureService(...)`. This works to arbitrary nesting depth. Arrays of objects are intentionally rejected (no clean single-flag CLI representation for a list of structured records).

## Core capability: documentation-as-specification

TSDoc tags double as both human-facing documentation and machine-readable CLI specification. Only `@description` is required, everything else has a graceful fallback:

```ts
/**
 * @name custom-command-name           // optional, defaults to the export name
 * @alias c                             // optional, short alias
 * @description What this does          // REQUIRED, no fallback possible
 * @option paramName description         // optional, marks as flag, falls back to "name (type)"
 * @argument paramName description       // optional, marks as positional argument
 * @example my-command --flag x         // optional, repeatable, rendered in --help
 */
export function myCommand(/* ... */) {}
```

Undocumented parameters still generate a working, validated CLI flag with a generic auto-generated help description. The generator never blocks a build over missing documentation detail, only over the one piece of information (`@description`) that genuinely cannot be inferred from anything else.

## Core capability: fail-loud validation

Rather than silently generating broken CLI code, the generator throws a specific, traceable error naming the exact export and parameter at fault:

- Missing `@description` entirely.
- A parameter type that is an array of objects (e.g. `{ id: string }[]`).
- A union type where not every member is a string literal (e.g. `string | number`).
- Any other unsupported/unresolvable type (functions, `Date`, class instances).
- `@argument` on an optional, boolean, enum, or array parameter.
- Same parameter tagged both `@argument` and `@option`.
- `@argument` name that doesn't match any top-level parameter.

Run the generator in `--check` mode as a CI gate to guarantee every exported function is CLI-compatible and properly documented.

## What it deliberately does not try to generate

Not every function belongs in this system, and the generator is designed to know its own limits:

- **Arrays of objects.** No sane single-flag CLI representation exists. Write this one command by hand against Commander directly.
- **Non-string-literal unions** (`string | number`).
- **Function/callback parameters, `Date`, class instances**, anything without a clean CLI-flag representation.
- **Commands with no meaningful CLI representation** (pure interactive flows with branching logic, custom validation chains). These are written by hand and registered alongside the generated commands.

## Usage modes

**As a standalone CLI:**

```sh
commander-codegen                                          # uses defaults
commander-codegen -i src/lib/commands.ts -o src/cli/gen.ts # custom paths
commander-codegen --check                                   # validate only, CI-friendly
```

**As a library:**

```ts
import { generate } from 'commander-codegen';

const result = generate({
  input: 'src/index.ts',
  output: 'src/lib/generated/commands.gen.ts',
});
```

## Project structure

```
src/
  lib/
    types.ts            — ParamInfo, CommandInfo, GenerateCliOptions, GenerateCliResult
    jsdoc-helpers.ts    — TSDoc tag extraction, @argument/@option tag map
    type-resolver.ts    — TS type → ParamKind resolution, nested object expansion
    extract-command.ts  — FunctionDeclaration → CommandInfo
    codegen.ts          — CommandInfo → Commander code string
    generate.ts         — Top-level generate() orchestrator
  cli.ts                — CLI binary entry point
  index.ts              — Public API re-exports
```

## When to reach for this

Use commander-codegen when a project needs:
- A library that also ships a CLI, with both surfaces built from the same functions.
- To add new CLI commands quickly, by writing a plain function and a few TSDoc tags rather than hand-rolling Commander argument parsing each time.
- Interactive prompting for missing required arguments, without writing Inquirer integration by hand for every command.
- Positional arguments for a subset of parameters via `@argument`, while keeping the rest as `--flag` options.
- A CI gate ensuring every exported function stays properly documented and CLI-compatible as the codebase grows.

Do not reach for it when a command's logic is inherently CLI-only (multi-step interactive wizards with branching, custom validation flows, side-effect-heavy flows with no meaningful return value) — those are better hand-written directly against Commander and registered alongside the generated commands.
