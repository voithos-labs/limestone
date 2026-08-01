import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { hmr: false } })],
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
		// The client build of svelte: the server build no-ops effects, so anything a test
		// drives through the runes graph would silently do nothing.
		conditions: ['browser']
	},
	test: {
		include: ['src/**/*.test.ts'],
		// A spy left installed leaks into the next case in its file; restoring at the runner is
		// the one place it cannot be forgotten.
		restoreMocks: true,
		// A suite needing a DOM opts in with a `// @vitest-environment jsdom` docblock.
		environment: 'node',
		// aragonite ships extensionless relative imports and uncompiled `.svelte`, neither of
		// which node's own resolver takes; inlining routes the package through vite as the dev
		// server already does.
		server: { deps: { inline: ['aragonite'] } }
	}
});
