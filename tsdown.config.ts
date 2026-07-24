import { defineConfig } from 'tsdown';

export default defineConfig({
	platform: 'node',
	format: ['esm'],
	dts: true,
	minify: true,
	skipNodeModulesBundle: true,
	treeshake: true,
	entry: ['./src/cli.ts'],
	exports: {
		bin: {
			'commander-codegen': './src/cli.ts',
		},
	},
});
