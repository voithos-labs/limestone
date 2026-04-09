const DEFAULT_FONT = 'Inter, system-ui, sans-serif';

export interface Theme {
	name: string;
	type: 'dark' | 'light';
	variables: Record<string, string>;
	fontFamily?: string;
}

export const DEFAULT_THEME: Theme = {
	name: 'Default Dark',
	type: 'dark',
	variables: {
		'color-bg': '#26282B',
		'color-surface': '#1A1C1D',
		'color-border': '#3A3D40',
		'color-text-primary': '#FFFFFF',
		'color-text-secondary': '#E6E5E5',
		'color-ui-dulled': '#AFB1B3',
		'color-ui-muted': '#666666',
		'color-accent': '#567B67',
		'color-accent-primary': '#567B67',
		'radius-ui': '4px',
		'radius-surface': '8px'
	}
};

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.style.setProperty('--font-ui', theme.fontFamily ?? DEFAULT_FONT);
}
