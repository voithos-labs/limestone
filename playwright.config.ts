import { defineConfig, devices } from '@playwright/test';

// The repo has no @types/node, and this is the only node global the config needs.
declare const process: { env: Record<string, string | undefined> };

// Vite is pinned to one port with strictPort, so the dev server and baseURL cannot drift. Both
// read `PORT`, which the spawned server inherits — set it to run beside another Vite holding 1420
// (a sibling aragonite showcase). Without it `reuseExistingServer` adopts whatever answers there,
// and a suite that never reaches this app reads as a wholesale regression in it.
const PORT = process.env.PORT || '1420';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	reporter: 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run dev',
		url: BASE_URL,
		// Locally a running dev server is the one you are iterating on; in CI a stray
		// server would silently become the system under test.
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
