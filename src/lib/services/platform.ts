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
