# Feature: app boot under a mocked Tauri backend

Covers `boot.spec.ts`. The app runs in a plain browser with every native call
answered by the fake backend in `e2e/support/tauri-mocks.ts`.

## Happy paths

- Boot with nothing seeded: the app shell renders and lands on the library page.
- Boot with a seeded markdown doc: the doc opens as the focused tab, titled after its
  filename, with its body in the editor.

## User interactions

- Typing into a seeded doc: the edit is written back through the document-write command,
  addressed by the path it was seeded under.
- Opening a doc without touching it: nothing is written. A mount that counted as an edit
  would rewrite every document the moment it was opened.

## Error cases

- Boot raises no uncaught page errors and logs no console errors.
- A document image resolves to an asset URL only the Tauri webview can serve, so fetching it fails
  in the browser. That failure is the browser's, not the app's, and does not count as a console
  error — but a failed fetch of anything else still does.
- Boot reaches for no command the fake backend lacks a handler for. A recorded unhandled
  command means the app gained a native dependency the mock layer has to answer.

## Covered elsewhere

- Flushing pending saves when the window closes: `editor-save.md`.
