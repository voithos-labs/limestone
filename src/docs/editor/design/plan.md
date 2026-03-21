# Implementation Plan

This document is the step-by-step implementation plan for the editor.

The plan is intentionally narrower than the full compatibility matrix. V1 should prove the core invariants before it expands the feature surface.

## Preconditions before broad implementation

The team should not jump straight into the full editor UI.

Required gates:

- complete the custom parser proof of concept from `architecture.md`
- complete the CST proof of concept from `cst.md`
- complete the input harness from `input-selection.md`
- confirm the v1 syntax matrix in `compatibility-matrix.md`

## V1 ship line

### First-class rich-editable in v1

- paragraphs
- ATX headings
- emphasis / strong / strikethrough
- inline code
- fenced code blocks
- ordered / unordered lists
- task lists
- blockquotes
- links and images
- thematic breaks
- hard line breaks
- bare URL/email autolinks

### Preserve + render minimally in v1

- setext headings
- reference links / definitions
- tables
- raw HTML
- footnotes
- math
- alerts
- details blocks
- emoji shortcodes
- GitHub issue / PR / mention / SHA autolinks

### Preserve via opaque/raw fallback

- malformed regions the richer renderer cannot safely own yet
- unsupported HTML constructs
- future syntax not yet modeled

## Phase 0: proof-of-concept gates

### Outcome

Prove the hardest invariants before building broad UI behavior.

### Deliverables

- custom two-pass parser proof-of-concept against a mixed GFM fixture
- byte-for-byte parse -> CST -> serialize round-trip
- CST examples for trivia ownership, delimiter accounting, and malformed regions
- validation against CommonMark and GFM spec test suites for supported syntax
- input harness for logical selection / DOM mapping / IME smoke tests

### Exit criteria

- exact round-trip passes on representative fixtures
- no source-corruption blocker bugs (see parser acceptance bar in `architecture.md`)
- CST ownership rules are validated with concrete examples covering trivia, delimiters, and recovery
- DOM/logical selection mapping works in a narrow harness

## Phase 1: source fidelity core

### Outcome

Create a reliable markdown-first engine with no editing UI ambition beyond test harnesses.

### Build

- `TextBuffer` abstraction with flat string backend
- file metadata envelope for newline style, BOM, and final newline
- custom two-pass parser (block structure pass, inline content pass)
- lossless CST builder with trivia ownership and delimiter accounting
- serializer
- history-ready transaction primitives with inverse splice storage (see `undo-redo.md`)
- round-trip and localized patch tests
- CommonMark and GFM spec test suite integration

### Non-goals

- full rendered UI
- broad command set
- table editing

### Exit criteria

- all mandatory and preserve-only spec sections pass per the parser acceptance bar in `architecture.md`
- exact serialize-without-edit round-trip on all passing fixtures
- untouched-region preservation tests passing
- malformed-region preservation tests passing
- parser is considered "v1-ready" per the criteria in `architecture.md`

## Phase 2: read-only rendered projection

### Outcome

Show that the CST can drive a rendered editor-like view.

### Build

- block projection
- inline projection
- Svelte renderer for supported v1 shapes
- rendering for preserve-only constructs using minimal or opaque components

### Exit criteria

- representative documents render stably
- node-to-DOM mapping scaffolding exists
- read-only rendering does not lose source fidelity in state transitions

## Phase 2.5: input harness

### Outcome

Derisk the hardest UI layer before broad editing work.

### Build

- paragraph editable island
- heading editable island
- list item editable island
- fenced code editable island
- image atom selection case
- DOM/logical selection reconciliation loop
- IME smoke tests
- clipboard smoke tests

### Exit criteria

- browser selection and logical selection can round-trip reliably in harness cases
- composition works in supported editable islands
- invalid DOM selection can be repaired safely

## Phase 3: minimal editing interactions

### Outcome

Support stable editing for the narrow v1 surface.

### Build

- text insertion/deletion in supported text blocks
- caret movement
- block split/merge for paragraphs and headings
- inline formatting commands
- undo/redo grouping with typing run coalescing and selection restoration (see `undo-redo.md`)
- atomic image selection and replacement flows

### Exit criteria

- editing works for paragraphs, headings, lists, blockquotes, and code fences
- undo/redo is reliable for typing and structural edits
- no browser-created structure escapes core control

### Early host feedback loop

If possible, a thin vertical slice of host integration (load document -> edit paragraph -> save) should be tested alongside this phase. The goal is to surface integration surprises early, not to complete the full host API. This does not change the Phase 5 scope.

## Phase 4: structural markdown commands

### Outcome

Expand from text editing to structural editing for the selected v1 syntax.

### Build

- ordered/unordered list commands
- task list toggles
- blockquote wrap/unwrap
- insert/remove thematic breaks
- link/image editing affordances
- hard break insertion behavior
- autolink handling

### Explicit deferrals

Do not add these as rich-editable in this phase:

- tables
- reference definitions
- setext heading transformations
- raw HTML structures

### Exit criteria

- v1 first-class syntax is functionally editable
- preserve-only syntax still round-trips without corruption

## Phase 5: host integration

### Outcome

Make the editor usable inside Limestone without coupling the core to Limestone internals.

### Build

- host save flow
- diagnostics and decorations
- link following hooks
- asset resolution and image import hooks (see asset paste/drop flow in `api.md`)
- document replacement flow and save conflict handling

### Exit criteria

- host can load, inspect, save, and replace documents intentionally
- asset import produces markdown destinations without vault logic in the core

## Phase 6: preserve-only syntax polish

### Outcome

Improve display and fallback editing for preserve-only syntax before attempting more rich editing.

### Build

- better minimal rendering for tables, footnotes, details, alerts, and math
- cleaner raw-edit fallback UX for opaque regions
- stronger diagnostics around unsupported constructs

### Exit criteria

- preserve-only syntax is understandable and safe to work with even without rich editing

## Future expansion phase

Only after the previous phases are stable should the editor consider:

- real table sub-editor support
- reference definition management UI
- setext heading transformations
- richer GitHub-specific feature editing
- partial reparse optimization
- more advanced extension surfaces

## Success metrics

The implementation is on track only if it continuously proves:

- exact round-trip correctness
- byte-identical untouched regions outside command blast radius
- stable selection behavior in supported contexts
- acceptable keystroke latency on realistic note-sized fixtures
