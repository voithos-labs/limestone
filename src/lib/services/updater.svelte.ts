import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toasts } from '$lib/toasts.svelte';
import { getAppInfo } from '$lib/models/Settings.svelte';

const LAST_VERSION_KEY = 'limestone:last-version';

export type UpdatePhase =
	'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error';

const BUSY: UpdatePhase[] = ['checking', 'downloading', 'installing'];

class UpdaterController {
	phase = $state<UpdatePhase>('idle');
	version = $state('');
	progress = $state(0);
	error = $state('');
	private update: Update | null = null;

	get busy(): boolean {
		return BUSY.includes(this.phase);
	}

	async check(): Promise<boolean> {
		if (this.busy) return false;
		this.phase = 'checking';
		this.error = '';
		try {
			const found = await check();
			if (!found) {
				this.update = null;
				this.phase = 'up-to-date';
				return false;
			}
			this.update = found;
			this.version = found.version;
			this.phase = 'available';
			return true;
		} catch (e) {
			this.error = String(e);
			this.phase = 'error';
			return false;
		}
	}

	async install(): Promise<void> {
		if (!this.update || this.busy) return;
		const update = this.update;
		this.phase = 'downloading';
		this.progress = 0;
		let total = 0;
		let received = 0;
		try {
			await update.downloadAndInstall((e) => {
				switch (e.event) {
					case 'Started':
						total = e.data.contentLength ?? 0;
						break;
					case 'Progress':
						received += e.data.chunkLength;
						this.progress = total > 0 ? received / total : 0;
						break;
					case 'Finished':
						this.progress = 1;
						this.phase = 'installing';
						break;
				}
			});
			await relaunch();
		} catch (e) {
			this.error = String(e);
			this.phase = 'error';
		}
	}
}

export const updater = new UpdaterController();

export async function notePostUpdate(): Promise<void> {
	let version = '';
	try {
		version = (await getAppInfo()).version;
	} catch {
		return;
	}
	if (!version) return;
	const last = localStorage.getItem(LAST_VERSION_KEY);
	localStorage.setItem(LAST_VERSION_KEY, version);
	if (last && last !== version) {
		toasts.push(`Updated to Limestone ${version}`, { variant: 'info', timeout: 7000 });
	}
}

export async function runStartupUpdateCheck(
	autoInstall: boolean,
	onNudge: () => void
): Promise<void> {
	const available = await updater.check();
	if (!available) return;
	if (autoInstall) {
		await updater.install();
	} else {
		toasts.push(`Limestone ${updater.version} is available`, {
			variant: 'update',
			action: { label: 'View', run: onNudge }
		});
	}
}
