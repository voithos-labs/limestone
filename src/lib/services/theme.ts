const DEFAULT_FONT = 'Inter, system-ui, sans-serif';

export interface Theme {
	name: string;
	type: 'dark' | 'light';
	variables: Record<string, string>;
	fontFamily?: string;
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
		'color-error': '#ff5f57',
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
		'color-error': '#d03025',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const SOFT_DARK: Theme = {
	name: 'Soft Dark',
	type: 'dark',
	variables: {
		'color-bg': '#2c2c2a',
		'color-surface': '#1a1a19',
		'color-border': '#3e3e3b',
		'color-text-primary': '#e8e8e5',
		'color-text-secondary': '#cfcfca',
		'color-ui-dulled': '#a3a39d',
		'color-ui-muted': '#8f8f89',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'color-error': '#ff5f57',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const SOFT_LIGHT: Theme = {
	name: 'Soft Light',
	type: 'light',
	variables: {
		'color-bg': '#dfddd7',
		'color-surface': '#efeee9',
		'color-border': '#c9c7c0',
		'color-text-primary': '#2a2a27',
		'color-text-secondary': '#4a4a45',
		'color-ui-dulled': '#71716a',
		'color-ui-muted': '#83837b',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'color-error': '#d03025',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_THEME = DEFAULT_DARK;

export const BUILTIN_THEMES: Record<string, Theme> = {
	'default-dark': DEFAULT_DARK,
	'soft-dark': SOFT_DARK,
	'default-light': DEFAULT_LIGHT,
	'soft-light': SOFT_LIGHT
};

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.style.setProperty('--font-ui', theme.fontFamily ?? DEFAULT_FONT);
	root.dataset.themeType = theme.type;
	root.style.background = theme.variables['color-backdrop'] ?? '';
	document.body.style.background = '';
}
