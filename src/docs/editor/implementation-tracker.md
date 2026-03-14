# Editor Implementation Tracker

This document tracks the current implementation status of the editor module against the design set in `src/docs/editor/design/`.

It should be updated whenever a meaningful editor milestone lands.

## Current status

- [x] Read and review the full editor design set
- [x] Confirm the first implementation slice should begin in the Phase 1 source-fidelity core, not the UI layer
- [x] Create the initial editor module scaffold under `src/lib/editor/`
- [x] Implement `TextBuffer` with a flat-string backend and line-start indexing
- [x] Implement file metadata helpers for BOM, preferred newline style, and final newline handling
- [x] Add a dedicated editor test path with `npm run test:editor`
- [x] Add initial tests for text buffer behavior and file metadata behavior
- [x] Resolve the first design concerns identified during implementation review

## Design concerns resolved

- [x] Define the session-only empty paragraph placeholder contract in `design/cst.md`
- [x] Align command semantics with the session-only empty paragraph placeholder model in `design/editing-semantics.md`
- [x] Align logical position handling with session-only placeholder positions in `design/input-selection.md`
- [x] Clarify that transient editor state is non-canonical in `design/architecture.md`
- [x] Tighten asset placeholder identity tracking in `design/api.md`
- [x] Choose a single Backspace behavior at the start of fenced code block bodies in `design/editing-semantics.md`

## Current recommendation

The next implementation slice should be the smallest testable part of the remaining Phase 1 core:

- [ ] Define transaction primitives around source ranges and inverse splices
- [ ] Define selection data structures anchored by source offsets
- [ ] Add document/session state for `dirty`, `loadedVersion`, and `lastSavedVersion`

These three pieces set up the parser and history layers without forcing early UI work.

## Phase checklist

## Phase 0: proof-of-concept gates

- [ ] Custom two-pass parser proof of concept against a mixed GFM fixture
- [ ] Byte-for-byte parse -> CST -> serialize round-trip proof
- [ ] CST examples for trivia ownership, delimiter accounting, and malformed regions
- [ ] Validation against CommonMark and GFM spec fixtures for supported syntax
- [ ] Narrow input harness for logical selection, DOM mapping, and IME smoke tests

## Phase 1: source fidelity core

- [x] `TextBuffer` abstraction with flat string backend
- [x] File metadata envelope for newline style, BOM, and final newline
- [ ] Custom two-pass parser
- [ ] Lossless CST builder with trivia ownership and delimiter accounting
- [ ] Serializer
- [ ] History-ready transaction primitives with inverse splice storage
- [ ] Round-trip and localized patch tests
- [ ] CommonMark and GFM spec test suite integration

## Phase 2: read-only rendered projection

- [ ] Block projection
- [ ] Inline projection
- [ ] Svelte renderer for supported v1 shapes
- [ ] Minimal or opaque rendering for preserve-only constructs

## Phase 2.5: input harness

- [ ] Paragraph editable island
- [ ] Heading editable island
- [ ] List item editable island
- [ ] Fenced code editable island
- [ ] Image atom selection case
- [ ] DOM/logical selection reconciliation loop
- [ ] IME smoke tests
- [ ] Clipboard smoke tests

## Phase 3: minimal editing interactions

- [ ] Text insertion and deletion in supported text blocks
- [ ] Caret movement
- [ ] Paragraph and heading split/merge
- [ ] Inline formatting commands
- [ ] Undo/redo grouping with typing coalescing and selection restoration
- [ ] Atomic image selection and replacement flows
- [ ] Thin host feedback loop for load -> edit -> save

## Phase 4: structural markdown commands

- [ ] Ordered / unordered list commands
- [ ] Task list toggles
- [ ] Blockquote wrap / unwrap
- [ ] Insert / remove thematic breaks
- [ ] Link and image editing affordances
- [ ] Hard break insertion behavior
- [ ] Autolink handling

## Phase 5: host integration

- [ ] Host save flow
- [ ] Diagnostics and decorations
- [ ] Link following hooks
- [ ] Asset resolution and image import hooks
- [ ] Document replacement flow and save conflict handling

## Phase 6: preserve-only syntax polish

- [ ] Better minimal rendering for tables, footnotes, details, alerts, and math
- [ ] Cleaner raw-edit fallback UX for opaque regions
- [ ] Stronger diagnostics around unsupported constructs

## Notes

- The implementation tracker is intentionally narrower than the full design set.
- A task should only be checked off when both implementation and a minimal validation path exist.
- Broad UI work should stay blocked until the proof-of-concept gates and core source-fidelity work are far enough along to protect round-trip correctness.
