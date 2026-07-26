import { defineConfig, devices } from '@playwright/test';

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
		reuseExistingServer: true,
		timeout: 120_000
	}
});
