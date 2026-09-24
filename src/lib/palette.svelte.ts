// The command palette: one popup for finding things and for doing things. Anything can raise
// it, optionally with a starting query
class PaletteController {
	open = $state(false);
	initial = $state('');

	show(initial = '') {
		this.initial = initial;
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const palette = new PaletteController();
