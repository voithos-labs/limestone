# Feature: mounting a document's editor

Covers `editor-mount.spec.ts`. Opening a document — at boot, on a tab switch — mounts an editor
and wires it up in one pass: the edit and selection listeners, the scroll listener, the header
observer the scroll coordinate depends on, and the restore of where the reader left off.

## Happy paths

- The wire-up runs once per open. A second pass is invisible to a reader — same caret, same
  scroll — but it tears the first down mid-flight and leaves two restores in the air, so any
  later change inherits a concurrency case nobody designed.

  Asserted structurally, by counting the adapter's own observers on the header slot: nothing
  user-facing tells one pass from two, and the editor keeps an observer of its own on the same
  element, so the count is attributed by where it was registered from.
