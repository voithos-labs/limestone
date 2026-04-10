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
		'color-bg': '#26282B',
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

export const DEFAULT_THEME = DEFAULT_DARK;

export const BUILTIN_THEMES: Record<string, Theme> = {
	'default-dark': DEFAULT_DARK,
	'default-dark-transparent': DEFAULT_DARK_TRANSPARENT
};

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.variables)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.style.setProperty('--font-ui', theme.fontFamily ?? DEFAULT_FONT);

	// Clean up any previous focus listeners
	if (_focusCleanup) { _focusCleanup(); _focusCleanup = null; }

	if (theme.transparentBackground) {
		root.style.background = 'transparent';
		document.body.style.background = theme.variables['color-bg'] ?? 'transparent';

		const fallback = '#26282B';
		root.style.transition = 'background 0.3s ease';
		const onBlur = () => { root.style.background = fallback; };
		const onFocus = () => { root.style.background = 'transparent'; };
		window.addEventListener('blur', onBlur);
		window.addEventListener('focus', onFocus);
		_focusCleanup = () => {
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('focus', onFocus);
		};
	} else {
		root.style.transition = '';
		root.style.background = '';
		document.body.style.background = '';
	}
}

let _focusCleanup: (() => void) | null = null;
