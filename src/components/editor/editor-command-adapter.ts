/**
 * The five formatting actions the toolbar offers, named for what they mean rather than for the
 * keys that also trigger them. Each one asks the editor to run a command it already owns.
 */
import { TOOLBAR_COMMANDS } from 'aragonite';
import type { EditorInstance } from 'aragonite';

export interface EditorFormatActions {
	toggleStrong(): boolean;
	toggleEmphasis(): boolean;
	toggleStrike(): boolean;
	toggleCode(): boolean;
	editLink(): boolean;
}

export function createEditorFormatActions(instance: EditorInstance): EditorFormatActions {
	// The ids ride the editor's own list, so a rename upstream arrives through the import instead
	// of leaving a stale string behind a button that still looks like it works.
	return {
		toggleStrong: () => instance.runCommand(TOOLBAR_COMMANDS.toggleStrong),
		toggleEmphasis: () => instance.runCommand(TOOLBAR_COMMANDS.toggleEmphasis),
		toggleStrike: () => instance.runCommand(TOOLBAR_COMMANDS.toggleStrikethrough),
		toggleCode: () => instance.runCommand(TOOLBAR_COMMANDS.toggleCode),
		editLink: () => instance.runCommand(TOOLBAR_COMMANDS.editLink)
	};
}
