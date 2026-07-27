# Feature: editing a document and writing it back

Covers `editor-save.spec.ts`. The app runs against the fake backend in
`e2e/support/tauri-mocks.ts`, so `getMockState(page).writes` is the record of what reached the
document-write command.

## Happy paths

- Opening a document places a caret: typing with no click at all reaches the document, and the
  edit is written back. The editor is usable the moment a note opens, the way a text field is.
- A document whose metadata lives in YAML frontmatter round-trips it: the editor edits the body
  alone, and the saved file still carries the frontmatter block and its custom keys.

## User interactions

- Closing the window writes an edit that no save window has reached yet. The window is destroyed
  only after the flush, so a document is never left on disk older than the one on screen. The
  editor batches keystrokes for undo and reports them a burst late, so what a flush writes is the
  editor's live source, not the last edit it was told about.
- Closing the tab does the same, and raises nothing on the way: the flush runs while the editor is
  being torn down, with no later save window to fall back on.
- Closing a window nobody typed in writes nothing. Flushing on the way out must not turn every
  opened document into a rewritten one — a document is dirty against the body the editor was
  handed, not against having been open.
- Deleting a document does not write it back. Deleting closes its tab, and that teardown flushes
  like any other — but the file is gone, and a flush reading the editor's live source would
  recreate it. Nothing may be written for that document once its delete is under way.

## Edge cases

- An empty document is typable on open too — there is no first block to click.
- A fast burst of keystrokes settles on a write carrying all of them. It may take more than one
  write to get there: the editor commits the first character on its own and the rest on a debounce
  of its own, longer than this adapter's, so a burst crosses two save windows. Each write is a
  truthful snapshot of the document at that moment, so what a scenario pins is the settled content
  and that the writes are nowhere near one per keystroke — never their exact number.

## Known deltas from the CodeMirror editor

Neither is enforced by a scenario above; both are recorded so a reader does not mistake them
for regressions.

- **No placeholder.** The old editor showed `Start writing...` in an empty document. aragonite
  exposes no placeholder prop, so an empty note renders one empty paragraph and nothing else.
  Closing it means an affordance in the editor rather than a port.
- **Clicking the empty space below the last block places no caret.** The old editor put the caret
  at the end of the document; aragonite's padding click focuses its root instead, which — as with
  a freshly opened document — establishes no caret. Restoring it is a host-side `setSelection` to
  the last block's end.
