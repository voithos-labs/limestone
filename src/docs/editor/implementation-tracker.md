# Editor Implementation Tracker

This document tracks the current implementation status of the editor module against the design set in `src/docs/editor/design/`.

It should be updated whenever a meaningful editor milestone lands.

## Current status

- [x] Read and review the full editor design set
- [x] Confirm implementation should begin with the Phase 0 proof-of-concept gates before broader editor work
- [x] Create the initial editor module scaffold under `src/lib/editor/`
- [x] Implement `TextBuffer` with a flat-string backend and line-start indexing
- [x] Implement file metadata helpers for BOM, preferred newline style, and final newline handling
- [x] Implement a narrow two-pass parser proof of concept against a mixed markdown fixture
- [x] Prove exact parse -> serialize round-trip on the mixed Phase 0 fixture
- [x] Implement CST proof-of-concept ownership, delimiter-accounting, and recovery examples
- [x] Add a dedicated editor test path with `npm run test:editor`
- [x] Add initial tests for text buffer behavior and file metadata behavior
- [x] Add initial tests for the Phase 0 parser proof of concept and round-trip harness
- [x] Add focused Phase 0 CST invariant and recovery tests
- [x] Add fixture-driven parser validation for selected supported, preserve-only, and malformed fallback cases
- [x] Expand the parser validation corpus with grouped CommonMark- and GFM-aligned fixtures plus metadata assertions
- [x] Add a headless input harness proof of concept for logical selection mapping, invalid-selection repair, image atoms, IME composition, and paste smoke tests
- [x] Add a read-only view projection proof of concept for flat block descriptors, inline runs, container context, and atomic image runs
- [x] Add a browser-backed Svelte editor harness prototype that renders the projection PoC and maps DOM selection through block and run keys
- [x] Add a narrow browser-backed beforeinput loop for text insertion, deletion, paste, and logical selection restoration
- [x] Resolve the first design concerns identified during implementation review

## Design concerns resolved

- [x] Define the session-only empty paragraph placeholder contract in `design/cst.md`
- [x] Align command semantics with the session-only empty paragraph placeholder model in `design/editing-semantics.md`
- [x] Align logical position handling with session-only placeholder positions in `design/input-selection.md`
- [x] Clarify that transient editor state is non-canonical in `design/architecture.md`
- [x] Tighten asset placeholder identity tracking in `design/api.md`
- [x] Choose a single Backspace behavior at the start of fenced code block bodies in `design/editing-semantics.md`

## Current recommendation

The next implementation slice should connect the current headless proofs to a browser-backed harness:

- [x] Render the projection proof of concept through a narrow Svelte editor harness
- [x] Build DOM node mapping from projection block and run keys
- [x] Prove browser selection round-trip for paragraph, heading, list item, fenced code, and image atom cases

The next narrow browser-backed editing follow-up should extend the live input path:

- [ ] Manually validate live `beforeinput` editing for paragraph, heading, list item, and fenced code cases
- [ ] Add `insertParagraph` handling for the supported editable blocks
- [ ] Extend the browser-backed harness with IME and richer clipboard smoke behavior

The remaining Phase 0 gates still derisk correctness before broader editor and transaction work begins. The browser-backed harness prototype now has a successful manual smoke pass for paragraph, heading, list item, fenced code, and image atom selection, and the live input path now routes narrow insertText, delete, and paste intents through the headless harness with automated coverage. The broader gate stays open until those browser edits are manually verified and extended to Enter and IME behavior.

## Phase checklist

### Phase 0: proof-of-concept gates

- [x] Custom two-pass parser proof of concept against a mixed GFM fixture
- [x] Byte-for-byte parse -> CST -> serialize round-trip proof
- [x] CST examples for trivia ownership, delimiter accounting, and malformed regions
- [ ] Validation against CommonMark and GFM spec fixtures for supported syntax
- [ ] Narrow input harness for logical selection, DOM mapping, and IME smoke tests

### Phase 1: source fidelity core

- [x] `TextBuffer` abstraction with flat string backend
- [x] File metadata envelope for newline style, BOM, and final newline
- [ ] Custom two-pass parser
- [ ] Lossless CST builder with trivia ownership and delimiter accounting
- [ ] Serializer
- [ ] History-ready transaction primitives with inverse splice storage
- [ ] Round-trip and localized patch tests
- [ ] CommonMark and GFM spec test suite integration

### Phase 2: read-only rendered projection

- [ ] Block projection
- [ ] Inline projection
- [ ] Svelte renderer for supported v1 shapes
- [ ] Minimal or opaque rendering for preserve-only constructs

Headless PoC coverage now exists for flat block descriptors, inline runs, container context, and atomic image rendering, and a narrow Svelte harness now consumes that projection. The checklist remains open until the renderer is validated across the broader supported v1 surface.

### Phase 2.5: input harness

- [ ] Paragraph editable island
- [ ] Heading editable island
- [ ] List item editable island
- [ ] Fenced code editable island
- [ ] Image atom selection case
- [ ] DOM/logical selection reconciliation loop
- [ ] IME smoke tests
- [ ] Clipboard smoke tests

Headless PoC coverage now exists for the Phase 2.5 cases above, and a browser-backed prototype now exposes the paragraph, heading, list item, fenced code, and image atom cases. Those selection paths now have a manual browser smoke pass, and the harness now routes narrow insertText, delete, and paste events through headless mutations with automated tests. The checklist remains open for live browser validation of that loop, plus IME and clipboard behavior beyond plain-text paste.

### Phase 3: minimal editing interactions

- [ ] Text insertion and deletion in supported text blocks
- [ ] Caret movement
- [ ] Paragraph and heading split/merge
- [ ] Inline formatting commands
- [ ] Undo/redo grouping with typing coalescing and selection restoration
- [ ] Atomic image selection and replacement flows
- [ ] Thin host feedback loop for load -> edit -> save

Headless and harness PoC coverage now exists for narrow text insertion and deletion routing in the supported editable blocks, but the Phase 3 checklist remains open until those interactions are expanded beyond the harness and validated as durable editor behavior.

### Phase 4: structural markdown commands

- [ ] Ordered / unordered list commands
- [ ] Task list toggles
- [ ] Blockquote wrap / unwrap
- [ ] Insert / remove thematic breaks
- [ ] Link and image editing affordances
- [ ] Hard break insertion behavior
- [ ] Autolink handling

### Phase 5: host integration

- [ ] Host save flow
- [ ] Diagnostics and decorations
- [ ] Link following hooks
- [ ] Asset resolution and image import hooks
- [ ] Document replacement flow and save conflict handling

### Phase 6: preserve-only syntax polish

- [ ] Better minimal rendering for tables, footnotes, details, alerts, and math
- [ ] Cleaner raw-edit fallback UX for opaque regions
- [ ] Stronger diagnostics around unsupported constructs

## Notes

- The implementation tracker is intentionally narrower than the full design set.
- A task should only be checked off when both implementation and a minimal validation path exist.
- Broad UI work should stay blocked until the proof-of-concept gates and core source-fidelity work are far enough along to protect round-trip correctness.
