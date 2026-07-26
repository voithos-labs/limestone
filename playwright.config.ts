import { defineConfig, devices } from '@playwright/test';

// The repo has no @types/node, and this is the only node global the config needs.
declare const process: { env: Record<string, string | undefined> };

// Vite is pinned to 1420 with strictPort, so the dev server and baseURL cannot drift.
const BASE_URL = 'http://localhost:1420';

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
