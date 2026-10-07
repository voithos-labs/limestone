export type WindowStyle = 'windows' | 'macos' | 'linux';

export const WINDOW_STYLE_AUTO = 'auto';

export function hostWindowStyle(): WindowStyle {
	const ua = navigator.userAgent;
	if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macos';
	if (ua.includes('Windows')) return 'windows';
	return 'linux';
}

export function resolveWindowStyle(setting: string | null): WindowStyle {
	if (setting === 'windows' || setting === 'macos' || setting === 'linux') return setting;
	return hostWindowStyle();
}

const flushers = new Set<() => Promise<void> | void>();
// todo: make sure to add debounced persists here in going forward, basicalyl waits for save before
//  closing window
export function registerFlush(fn: () => Promise<void> | void): () => void {
	flushers.add(fn);
	return () => flushers.delete(fn);
}

export async function flushAll(): Promise<void> {
	await Promise.all([...flushers].map((fn) => fn()));
}
