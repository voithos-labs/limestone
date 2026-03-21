# Input and Selection Design

This document defines the v1 contract for input handling, logical selection, DOM reconciliation, and IME behavior.

This is one of the highest-risk parts of the editor.

## Core rule

The browser DOM selection is not the source of truth.

The source of truth is a logical editor selection stored in editor state.

The DOM selection is a projection that must be reconciled back to the logical selection after renders and browser events.

## V1 scope

V1 input support should focus on a narrow but stable set of editable regions:

- paragraph text
- ATX heading text
- list item text
- blockquote text
- inline formatting within those text regions
- fenced code body text
- link and image destinations through explicit editing affordances

Not rich-editable in v1:

- tables as a full cell editor
- reference definition management UI
- setext heading structure editing
- raw HTML structure editing
- advanced GitHub-specific structures like alerts, details, and footnotes

Those may render minimally and fall back to raw editing.

## Logical selection model

A selection consists of:

- `anchor`
- `focus`
- direction metadata if needed by the UI
- an optional selection kind

### Selection kinds

V1 should support at least:

- `text` - range inside text-bearing content
- `node` - whole atomic inline or block node selected
- `block` - block-level selection handle or structural selection

### Selection anchoring

Selection positions are fundamentally **source-offset-based**.

Every logical position resolves to an offset in the source buffer. This is the primary anchor. CST node context (node kind, relative position within the node) is used as a heuristic aid for disambiguation, but the source offset is the recovery primitive.

Why source offsets as primary:

- the source buffer is canonical; source offsets are always valid regardless of CST structure
- after a full reparse, the source buffer is unchanged outside the blast radius, so offsets outside the blast radius remain stable
- within the blast radius, offsets may shift by the splice delta, which is simple arithmetic
- no dependency on CST node identity for selection stability

After reparse:

1. map the old source offset through the splice delta to get the new offset
2. resolve the new offset against the new CST to find the owning node
3. if the offset lands at a valid position (inside text, before/after an atom, etc.), accept it
4. if the offset lands at an invalid position (inside a delimiter, inside structural chrome), snap to the nearest valid position within the same block
5. if the owning block no longer exists or has changed kind, snap to the nearest block boundary

This is simpler and more robust than maintaining complex hybrid anchor formats.

## Logical positions

The position model should distinguish between:

- text offsets inside text-bearing regions
- before/after atomic inline nodes
- before/after void blocks
- start/end of block
- session-only placeholder offsets anchored to insertion gaps
- raw-edit offsets inside opaque regions

### Atomic and void rules

- images and similar atomic inline nodes allow caret positions only before or after the node unless an explicit edit UI is opened
- thematic breaks behave as void blocks, with before/after positions or block selection only
- fenced code bodies are plain-text islands with their own internal offsets
- session-only empty paragraph placeholders expose caret positions anchored to insertion gaps until real text is inserted
- opaque blocks and inlines expose raw-text editing surfaces, not fake rich-text editing

## Editable strategy

The editor uses a single `contenteditable` root element with controlled rendering.

### Why a single contenteditable root

- native cross-block selection works without custom reimplementation
- IME composition works natively across content
- browser accessibility features (screen readers, keyboard navigation) work with the standard editing model
- this is the proven approach used by ProseMirror, Slate, and similar production editors

The alternative — per-block `contenteditable` regions with inert structural chrome — was considered and rejected. It makes cross-block selection and IME at block boundaries significantly harder to implement correctly, and those are already high-risk areas.

### Structural control

The browser must not be allowed to invent structure. To prevent this:

- structural chrome (list markers, blockquote gutters, code fence delimiters) is rendered with `contenteditable="false"` on the chrome elements
- atomic nodes (images, thematic breaks) are rendered with `contenteditable="false"`
- the `beforeinput` handler intercepts all mutations and translates them into editor transactions
- after each transaction, the DOM is reconciled from the view projection, overwriting any browser-created structure

### What this means for the reconciliation loop

The browser may briefly create invalid DOM between a `beforeinput` event and the editor's next render. The reconciliation loop must:

- not read back browser-mutated DOM as source of truth
- apply the transaction to the source buffer and CST
- render the correct DOM from the new projection
- restore selection from the logical model

This is a stronger invariant than just repairing DOM selection. The editor overwrites DOM content after every transaction, not just selection.

## DOM mapping

The UI layer should maintain a bidirectional mapping between:

- logical positions
- DOM text nodes and offsets
- atomic node boundaries

This mapping should be rebuilt or patched after render commits.

## Reconciliation loop

The editor should use a predictable reconciliation loop.

### On browser input

1. read current DOM selection
2. map it to the closest valid logical selection
3. process the event into a transaction or selection update
4. commit editor state
5. render updated DOM
6. map logical selection back into DOM
7. repair DOM selection if the browser drifted into an invalid location

### On `selectionchange`

- map browser selection to logical selection
- if the browser selection is valid, accept it
- if it lands in invalid DOM, snap to the nearest valid logical position
- do not let invalid browser selection become canonical editor state

## `beforeinput` handling

`beforeinput` should be the primary text-edit event source.

V1 should explicitly handle at least:

- `insertText`
- `insertParagraph`
- `deleteContentBackward`
- `deleteContentForward`
- `insertFromPaste`
- `insertFromDrop`
- composition-related insertions

The core should translate these events into transactions instead of applying browser DOM mutations directly.

## IME policy

IME must be treated as a first-class concern, not an afterthought.

### V1 IME contract

- support IME composition inside leaf text editable islands
- do not attempt IME across structural boundaries
- anchor composition to a logical selection range
- reconcile composition updates through the transaction system or a tightly controlled transient composition buffer

### Composition flow

1. `compositionstart` captures the logical anchor range
2. `compositionupdate` updates the composition text in the active leaf region
3. `compositionend` commits final text as a normal transaction
4. selection is reconciled after commit

### Failure rule

If composition lands in an unsupported structural context, the editor should move the user into a raw text fallback for that region rather than allowing undefined behavior.

## Clipboard and drag behavior

### Copy

- copy should use logical selection, not arbitrary DOM extraction
- atomic node selections should serialize as their markdown source
- text selections across structure should serialize as markdown fragments

### Paste

- paste must first become a logical insertion intent
- incoming line endings should be normalized to the current document line ending style
- pasted HTML should go through a constrained import path, not direct DOM insertion
- pasted files/images should route through the asset import adapter

### Drag selection across atomic nodes

If a drag spans across atomic nodes:

- represent the endpoints as before/after logical positions
- if the selection fully encloses an atomic node, it may become part of the selection as a node boundary span
- do not invent caret positions inside atomic nodes

## Special region behavior

### Code fences

- code fence bodies are plain-text editing regions
- no inline markdown parsing applies inside the code body
- `Enter` and deletion operate as plain text until the user structurally exits the block

### Tables

V1 should not attempt a full table sub-editor.

Recommended v1 behavior:

- render tables readably
- allow block-level selection
- permit raw-edit fallback for the table source slice
- defer real cell navigation and tabular editing until later

### Opaque regions

Opaque regions should be editable through a raw text surface bound directly to the owned source slice.

This is safer than pretending unsupported syntax is richly editable.

## Recovery behavior when DOM and logical state diverge

The editor should always prefer logical state over accidental DOM state.

If DOM and logical state diverge:

- repair DOM selection to the nearest valid mapped position
- if a mapped position cannot be recovered, snap to the owning block boundary
- log or surface diagnostics in development builds
- never silently commit impossible DOM positions into editor state

## Transient malformed state behavior

During editing, the user's keystrokes frequently create temporarily malformed markdown. For example:

- typing `[` begins a link that is not yet closed
- deleting a code fence closer leaves an unclosed fence
- typing `**` starts bold that is not yet terminated

### Visual contract

- transient malformed states should render gracefully, not produce visual glitches or layout jumps
- incomplete inline constructs should render as literal text (showing the raw delimiter characters) until the construct is completed
- incomplete block constructs (e.g., unclosed code fence) should render the affected content as a code block with a visual indicator that the fence is unclosed
- the editor should never show an error state for normal in-progress typing

### Implementation

- the parser's recovery and opaque node handling defined in `cst.md` already preserves malformed regions
- the view projection should render recovery nodes as styled raw text, not as broken rich rendering
- visual indicators for incomplete constructs (e.g., a subtle border or background on an unclosed fence) may be added as decorations rather than changes to source
- rendering must remain stable across rapid keystrokes; the keystroke batching described in `architecture.md` helps by coalescing multiple intermediate malformed states into a single render

## Raw-edit fallback UX

Raw-edit mode is the safety valve for preserve-only and opaque syntax. It must be defined concretely enough to implement.

### Entry

- the user clicks or navigates into a preserve-only block (table, raw HTML, reference definition, etc.)
- the block transitions to raw-edit mode, showing the exact source slice as editable plain text
- entry may also happen via a dedicated "edit source" affordance on the block

### Visual treatment

- raw-edit regions should be visually distinct: monospace font, subtle background or border to indicate raw mode
- the distinction should be clear but not alarming; this is a normal editing state, not an error
- the rendered preview of the block (if any) may be shown alongside or replaced by the raw source; v1 should replace rather than split

### Editing behavior

- all editing within a raw-edit region operates as plain text against the source slice
- no inline markdown parsing or rich formatting applies
- Enter inserts a literal newline
- Backspace/Delete operate on characters
- standard text selection and clipboard behavior apply
- structural editor commands (toggle heading, toggle list, etc.) are no-ops while the cursor is in a raw-edit region

### Exit

- the user clicks outside the raw-edit region, or presses Escape
- on exit, the modified source slice is committed as a transaction
- the block is reparsed; if the parse result is now a supported rich-editable structure, it renders richly
- if the parse result is still preserve-only or opaque, it returns to minimal rendering

### Selection spanning

- a selection may span from a rich region into a raw-edit region, but structural commands apply only to the rich portion
- copy across the boundary serializes both portions as markdown source

### Undo behavior

- edits within a raw-edit session follow the same undo grouping rules as normal text editing (see `undo-redo.md`)
- entering and exiting raw-edit mode is not itself an undo step; only source changes are

### Decorations

- host-provided decorations (diagnostics, search highlights) should still render within raw-edit regions, mapped to source offsets

## Required design examples

Before broad editing implementation, this design should be exercised against explicit examples for:

- typing at the start and end of a heading
- backspace at paragraph/list boundaries
- caret movement over an image atom
- IME composition inside a paragraph and inside a code fence
- selection across blockquote to list item boundary
- paste into a fenced code block
- raw-edit fallback for a table and for opaque HTML

## Input harness requirement

Before the main editing phase, build a narrow input harness that proves:

- logical selection to DOM mapping
- DOM to logical reconciliation
- one paragraph editor
- one heading editor
- one list item editor
- one fenced code editor
- one image atom selection case
- IME smoke tests
- clipboard smoke tests

This harness is a required gate in `plan.md`.
