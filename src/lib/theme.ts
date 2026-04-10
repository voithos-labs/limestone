const DEFAULT_FONT = 'Inter, system-ui, sans-serif';

export interface Theme {
	name: string;
	type: 'dark' | 'light';
	variables: Record<string, string>;
	fontFamily?: string;
	transparentBackground?: boolean; // default: false
}

export const DEFAULT_DARK: Theme = {
	name: 'Default Dark',
	type: 'dark',
	variables: {
		'color-bg': '#2d3033',
		'color-surface': '#1A1C1D',
		'color-border': '#3A3D40',
		'color-text-primary': '#FFFFFF',
		'color-text-secondary': '#E6E5E5',
		'color-ui-dulled': '#AFB1B3',
		'color-ui-muted': '#A4A4A4',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_DARK_TRANSPARENT: Theme = {
	name: 'Default Dark (Transparent)',
	type: 'dark',
	transparentBackground: true,
	variables: {
		'color-bg':
			'linear-gradient(to bottom left, rgb(57 57 66 / 0.1) 0%, rgb(57 57 66 / 0.025) 100%)' /* 25% top right to 0.1 rest */,
		'color-bg-opaque': '#2d3033',
		'color-surface': '#1A1C1D',
		'color-border': '#3A3D40' /* #3A3D40 */,
		'color-text-primary': '#FFFFFF',
		'color-text-secondary': '#E6E5E5',
		'color-ui-dulled': '#AFB1B3',
		'color-ui-muted': '#A4A4A4',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_LIGHT: Theme = {
	name: 'Default Light',
	type: 'light',
	variables: {
		'color-bg': '#ece6e9',
		'color-surface': '#FFFFFF',
		'color-border': '#D0CCD0',
		'color-text-primary': '#000000',
		'color-text-secondary': '#232325',
		'color-ui-dulled': '#5C5F62',
		'color-ui-muted': '#787a7c',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_LIGHT_TRANSPARENT: Theme = {
	name: 'Default Light (Transparent)',
	type: 'light',
	transparentBackground: true,
	variables: {
		'color-bg':
			'linear-gradient(to bottom left, rgb(235 230 233 / 0.1) 0%, rgb(235 230 233 / 0.05) 100%)',
		'color-bg-opaque': '#EBE6E9',
		'color-surface': '#FFFFFF',
		'color-border': '#D0CCD0',
		'color-text-primary': '#101212',
		'color-text-secondary': '#3A3D40',
		'color-ui-dulled': '#5C5F62',
		'color-ui-muted': '#2b2b2c',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DARK_EARTH: Theme = {
	name: 'Dark Earth',
	type: 'dark',
	variables: {
		'color-bg': '#2d3033',
		'color-earth': '#8B6B47',
		'color-backdrop':
			'radial-gradient(ellipse 80% 60% at top left, color-mix(in srgb, var(--color-accent) 40%, var(--color-bg)) 0%, transparent 55%), radial-gradient(ellipse 80% 60% at bottom right, color-mix(in srgb, var(--color-earth) 35%, var(--color-bg)) 0%, transparent 55%), var(--color-bg)',
		'color-surface': '#1A1C1D',
		'color-border': '#3A3D40',
		'color-text-primary': '#FFFFFF',
		'color-text-secondary': '#E6E5E5',
		'color-ui-dulled': '#AFB1B3',
		'color-ui-muted': '#A4A4A4',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const LIGHT_EARTH: Theme = {
	name: 'Light Earth',
	type: 'light',
	variables: {
		'color-bg': '#dfd9dd',
		'color-earth': '#8B6B47',
		'color-backdrop':
			'radial-gradient(ellipse 80% 60% at top left, color-mix(in srgb, var(--color-accent) 28%, var(--color-bg)) 0%, transparent 55%), radial-gradient(ellipse 80% 60% at bottom right, color-mix(in srgb, var(--color-earth) 24%, var(--color-bg)) 0%, transparent 55%), var(--color-bg)',
		'color-surface': '#FFFFFF',
		'color-border': '#D0CCD0',
		'color-text-primary': '#000000',
		'color-text-secondary': '#3A3D40',
		'color-ui-dulled': '#5C5F62',
		'color-ui-muted': '#787a7c',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_THEME = DEFAULT_DARK;

export const BUILTIN_THEMES: Record<string, Theme> = {
	'default-dark': DEFAULT_DARK,
	'default-dark-transparent': DEFAULT_DARK_TRANSPARENT,
	'dark-earth': DARK_EARTH,
	'default-light': DEFAULT_LIGHT,
	'default-light-transparent': DEFAULT_LIGHT_TRANSPARENT,
	'light-earth': LIGHT_EARTH
};

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.style.setProperty('--font-ui', theme.fontFamily ?? DEFAULT_FONT);
	root.dataset.themeType = theme.type;

	// Tear down any previous focus listener before installing or skipping
	if (_focusCleanup) {
		_focusCleanup();
		_focusCleanup = null;
	}

	if (theme.transparentBackground) {
		const transparentBg = theme.variables['color-bg'] ?? 'transparent';
		const opaqueBg = theme.variables['color-bg-opaque'] ?? transparentBg;

		const applyFocused = () => {
			root.style.background = 'transparent';
			document.body.style.background = transparentBg;
		};
		const applyBlurred = () => {
			root.style.background = opaqueBg;
			document.body.style.background = transparentBg;
		};

		// Initial state matches current focus
		if (document.hasFocus()) applyFocused();
		else applyBlurred();

		window.addEventListener('blur', applyBlurred);
		window.addEventListener('focus', applyFocused);
		_focusCleanup = () => {
			window.removeEventListener('blur', applyBlurred);
			window.removeEventListener('focus', applyFocused);
		};
	} else {
		const backdrop = theme.variables['color-backdrop'];
		root.style.background = backdrop ?? '';
		document.body.style.background = '';
	}
}

let _focusCleanup: (() => void) | null = null;
