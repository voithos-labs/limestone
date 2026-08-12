import { describe, expect, it, vi } from 'vitest';
import { createEditorFormatActions } from './editor-command-adapter';
import type { EditorInstance } from 'aragonite';

function stub() {
	const runCommand = vi.fn().mockReturnValue(true);
	return { instance: { runCommand } as unknown as EditorInstance, runCommand };
}

describe('the format adapter', () => {
	// The ids are spelled out rather than read back from the editor's const: that is what makes a
	// coordinated rename upstream turn this red instead of passing against its own new spelling.
	it('routes each action to the door with its own command id', () => {
		const { instance, runCommand } = stub();
		const actions = createEditorFormatActions(instance);
		actions.toggleStrong();
		actions.toggleEmphasis();
		actions.toggleStrike();
		actions.toggleCode();
		actions.editLink();
		expect(runCommand.mock.calls.map(([id]) => id)).toEqual([
			'format.toggleStrong',
			'format.toggleEmphasis',
			'format.toggleStrikethrough',
			'format.toggleCode',
			'link.openCard'
		]);
	});

	it('reports what the editor answered, so a declined command is not shown as done', () => {
		const { instance, runCommand } = stub();
		runCommand.mockReturnValue(false);

		expect(createEditorFormatActions(instance).toggleStrong()).toBe(false);
	});
});
