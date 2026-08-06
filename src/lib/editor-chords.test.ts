// @vitest-environment jsdom
/**
 * Guards the line between the app's shortcuts and the document's. The app's window handler
 * captures, so a key it wrongly claims never reaches the document, and one it wrongly gives up
 * stops working while a document is open.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorInstance } from 'aragonite';
import { appEditorShortcut, editorTakesKey, registerDocumentEditor } from './editor-chords';

/** Stands in for the real editor: it takes Mod+B, the way aragonite takes it for bold. */
function fakeEditor(asked: string[]): EditorInstance {
	return {
		claimsChord(e: KeyboardEvent) {
			asked.push(e.key);
			return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b';
		}
	} as unknown as EditorInstance;
}

/** Presses a key at an element and reports what the window handler would have decided. */
function pressAt(target: Element, init: KeyboardEventInit): boolean {
	let takenByDocument = false;
	const listener = (e: Event) => {
		takenByDocument = editorTakesKey(e as KeyboardEvent);
	};
	window.addEventListener('keydown', listener, true);
	target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
	window.removeEventListener('keydown', listener, true);
	return takenByDocument;
}

describe('what a focused document takes', () => {
	let asked: string[];
	let unregister: () => void;
	let block: Element;
	let titleField: Element;
	let quickSearch: Element;

	beforeEach(() => {
		document.body.innerHTML = `
			<div class="editor">
				<div class="editor-header"><input class="title-input" /></div>
				<div class="text-editable-block" contenteditable="true">Body text here.</div>
			</div>
			<input class="quick-search-input" />`;
		block = document.querySelector('.text-editable-block')!;
		titleField = document.querySelector('.title-input')!;
		quickSearch = document.querySelector('.quick-search-input')!;
		asked = [];
		unregister = registerDocumentEditor(fakeEditor(asked));
	});

	afterEach(() => unregister());

	it('leaves the editor its own chord', () => {
		expect(pressAt(block, { key: 'b', ctrlKey: true })).toBe(true);
	});

	it('keeps a chord the editor does not take, so app shortcuts still fire while typing', () => {
		expect(pressAt(block, { key: 'w', ctrlKey: true })).toBe(false);
		expect(asked).toEqual(['w']);
	});

	it('keeps zoom and the mode toggle, which the app runs itself inside the document', () => {
		expect(pressAt(block, { key: '=', ctrlKey: true })).toBe(true);
		expect(pressAt(block, { key: '-', ctrlKey: true })).toBe(true);
		expect(pressAt(block, { key: 'e', ctrlKey: true })).toBe(true);
	});

	it('hands the title field back to the app, since renaming is not editing', () => {
		expect(pressAt(titleField, { key: 'b', ctrlKey: true })).toBe(false);
	});

	it('never asks the editor about a key pressed outside a document', () => {
		expect(pressAt(quickSearch, { key: 'b', ctrlKey: true })).toBe(false);
		expect(asked).toEqual([]);
	});

	it('gives the keys back once the document closes', () => {
		unregister();

		expect(pressAt(block, { key: 'b', ctrlKey: true })).toBe(false);
		expect(asked).toEqual([]);
	});
});

describe('the shortcuts the app adds inside a document', () => {
	it('reads both plus keys as zoom in, shifted or not', () => {
		expect(appEditorShortcut(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))).toBe(
			'zoom-in'
		);
		expect(
			appEditorShortcut(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, shiftKey: true }))
		).toBe('zoom-in');
	});

	it('takes Cmd as readily as Ctrl', () => {
		expect(appEditorShortcut(new KeyboardEvent('keydown', { key: 'e', metaKey: true }))).toBe(
			'cycle-mode'
		);
	});

	it('leaves the mode toggle alone when another modifier is held', () => {
		expect(
			appEditorShortcut(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
		).toBeNull();
		expect(
			appEditorShortcut(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, altKey: true }))
		).toBeNull();
	});

	it('claims nothing without Ctrl or Cmd', () => {
		expect(appEditorShortcut(new KeyboardEvent('keydown', { key: 'e' }))).toBeNull();
		expect(appEditorShortcut(new KeyboardEvent('keydown', { key: '-' }))).toBeNull();
	});
});
