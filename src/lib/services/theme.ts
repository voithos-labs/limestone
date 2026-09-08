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

export const HIGH_CONTRAST_DARK: Theme = {
	name: 'High Contrast Dark',
	type: 'dark',
	variables: {
		'color-bg': '#1e2124',
		'color-surface': '#000000',
		'color-border': '#cfd3d6',
		'color-text-primary': '#ffffff',
		'color-text-secondary': '#f0f1f2',
		'color-ui-dulled': '#d2d5d8',
		'color-ui-muted': '#b6babd',
		'color-accent': '#7ed3a4',
		'color-accent-primary': '#7ed3a4',
		'color-error': '#ff8f87',
		'focus-ring': '#ffffff',
		'focus-border': '#ffffff',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const HIGH_CONTRAST_LIGHT: Theme = {
	name: 'High Contrast Light',
	type: 'light',
	variables: {
		'color-bg': '#dcdee1',
		'color-surface': '#ffffff',
		'color-border': '#2b2e31',
		'color-text-primary': '#000000',
		'color-text-secondary': '#121314',
		'color-ui-dulled': '#333638',
		'color-ui-muted': '#414447',
		'color-accent': '#234b36',
		'color-accent-primary': '#234b36',
		'color-error': '#85110a',
		'focus-ring': '#000000',
		'focus-border': '#000000',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export const DEFAULT_THEME = DEFAULT_DARK;

export const BUILTIN_THEMES: Record<string, Theme> = {
	'default-dark': DEFAULT_DARK,
	'soft-dark': SOFT_DARK,
	'high-contrast-dark': HIGH_CONTRAST_DARK,
	'default-light': DEFAULT_LIGHT,
	'soft-light': SOFT_LIGHT,
	'high-contrast-light': HIGH_CONTRAST_LIGHT
};

export interface AccentPreset {
	name: string;
	light: string;
	dark: string;
}

export const ACCENT_PRESETS: Record<string, AccentPreset> = {
	slate: { name: 'Slate', light: '#5b7286', dark: '#6d8ba3' },
	violet: { name: 'Violet', light: '#75689a', dark: '#8d7fb5' },
	copper: { name: 'Copper', light: '#C56836', dark: '#C56836' },
	amber: { name: 'Amber', light: '#a3812f', dark: '#c2a04a' },
	rose: { name: 'Rose', light: '#a05e72', dark: '#b87990' },
	teal: { name: 'Teal', light: '#3f7f7a', dark: '#569a94' },
	mono: { name: 'Mono', light: '#5c5c5c', dark: '#9a9a9a' }
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexLuminance(hex: string): number {
	let h = hex.replace('#', '');
	if (h.length === 3)
		h = h
			.split('')
			.map((c) => c + c)
			.join('');
	const n = parseInt(h, 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function accentContrast(hex: string): string {
	if (!HEX_RE.test(hex)) return '#ffffff';
	return hexLuminance(hex) > 0.45 ? '#1a1c1d' : '#ffffff';
}

export function resolveAccent(
	setting: string,
	type: 'dark' | 'light'
): { accent: string; contrast: string } | null {
	const preset = ACCENT_PRESETS[setting];
	if (preset) {
		const hex = type === 'dark' ? preset.dark : preset.light;
		return { accent: hex, contrast: accentContrast(hex) };
	}
	if (HEX_RE.test(setting)) {
		const lum = hexLuminance(setting);
		let accent = setting;
		if (type === 'dark' && lum < 0.08) accent = `color-mix(in oklab, ${setting} 72%, white)`;
		else if (type === 'light' && lum > 0.6) accent = `color-mix(in oklab, ${setting} 72%, black)`;
		return { accent, contrast: accentContrast(setting) };
	}
	return null;
}

export function applyAccent(setting: string | null, type: 'dark' | 'light') {
	if (!setting || setting === 'default') return;
	const resolved = resolveAccent(setting, type);
	if (!resolved) return;
	const root = document.documentElement;
	root.style.setProperty('--color-accent', resolved.accent);
	root.style.setProperty('--color-accent-primary', resolved.accent);
	root.style.setProperty('--color-accent-contrast', resolved.contrast);
}

let appliedKeys: string[] = [];

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const key of appliedKeys) {
		if (!(key in theme.variables)) root.style.removeProperty(`--${key}`);
	}
	appliedKeys = Object.keys(theme.variables);
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(`--${key}`, value);
	}
	// The theme's own accent, preserved so the "default" accent swatch can show it
	// even while a preset override has replaced --color-accent
	root.style.setProperty('--color-accent-default', theme.variables['color-accent'] ?? '#567b67');
	root.style.setProperty(
		'--color-accent-contrast',
		accentContrast(theme.variables['color-accent'] ?? '#567b67')
	);
	root.style.setProperty('--font-ui', theme.fontFamily ?? DEFAULT_FONT);
	root.dataset.themeType = theme.type;
	root.style.background = theme.variables['color-backdrop'] ?? '';
	document.body.style.background = '';
}
