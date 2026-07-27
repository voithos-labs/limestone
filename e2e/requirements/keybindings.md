# Feature: which keystrokes the app claims while a document is focused

Covers `keybindings.spec.ts`. The window handler in `+page.svelte` runs in the capture phase, so
whatever it claims never reaches the editor. The policy it enforces: an app chord keeps working
while you type — closing a tab mid-sentence is exactly when you want it — except for the chords the
editor itself binds, which pass through untouched when focus is in the document.

## Happy paths

- Mod+B with a word selected in a block bolds it. The chord reaches the editor rather than being
  swallowed on its way there.
- Mod+I italicizes rather than opening settings. Its old app binding made italic unreachable while
  typing, which is the whole reason the policy exists.
- Mod+, opens settings, from a focused document as readily as from anywhere else. Settings moved
  off Mod+I and has to stay reachable without leaving the document first, so its replacement is a
  chord the editor does not claim.
- Mod+F opens the editor's find bar with the caret in a block.
- Mod+W closes the tab while typing. An app chord the editor does not bind is untouched by the
  policy.

## Edge cases

- A shortcut the reader rebound onto Mod+B loses to the editor while the caret is in a document:
  the word bolds and the rebound action does not run. The editor's claim outranks a user binding,
  not just a default one.
- The same rebinding fires while renaming the document in the title field. That field rides inside
  the editor's root but is the app's own chrome, and the editor hands its keystrokes back whole —
  renaming is not editing the document, and closing the tab from the title bar has to work.
- The same rebinding fires from the library, where quick search holds focus and no editor is
  mounted. Focus in a field is the point: the chord is only the editor's where the editor can act
  on it, not in every text field the app has.
- ArrowDown inside a wrapped paragraph moves the caret and does not page the document. A caret
  crossing into the next block is the editor's own and never reaches the window's scroll fallback,
  so only a move within one block leaves the fallback free to claim the key.

## Accepted

- Mod+I and Mod+B ask the editor to format a selection, and do nothing at a bare caret: aragonite
  reads the selection to wrap (`getRawSelection` returns null while it is collapsed) and its toggle
  returns without touching the block. A reader who presses Mod+I and then types gets plain text —
  there is no pending-emphasis state to type into. The chord is still swallowed, so nothing else
  happens either. Every scenario above selects first, which is why the suite never saw it.

## Not pinned by a scenario

- The scroll fallback also stands down when focus is on the editor's own root or on chrome inside
  it — neither is a text field, so only the `.editor` entry in the `EDITABLE` selector suppresses
  it. No scenario separates that from the browser's native arrow-scroll: both are a scroll of the
  same element in the same direction, and a scroll position cannot say which produced it.
- macOS reads Ctrl+B as bold in the editor but as a distinct chord in the app, so a Mac reader who
  rebinds an app action onto Ctrl+B takes it from the editor. Windows is the tested platform and
  the two agree there.
- The editor's zoom-in chord is reserved as Mod+= alone. The adapter also accepts the shifted and
  numpad plus, so a reader who rebinds an app action onto Mod+Shift+= takes zoom-in from the
  editor. Nothing binds either today.
