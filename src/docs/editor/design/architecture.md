# Architecture

## Purpose

This document defines the overall architecture for the editor module and the main implementation constraints for v1.

## Core product goals

The editor must:

- edit markdown through a rendered, Obsidian-like experience
- preserve markdown source losslessly
- stay reusable outside Limestone
- separate host concerns from editor concerns

## Canonical state model

The editor maintains three linked representations.

In addition to these canonical representations, the editor may maintain limited **session-only transient state** for interaction purposes, such as IME composition anchors or empty paragraph placeholders anchored to insertion gaps. This state must never be serialized as canonical markdown and must remain discardable without loss of source fidelity.

### 1. Source buffer

The canonical document is markdown source text.

V1 strategy:

- use a `TextBuffer` abstraction
- back it with a flat string plus a line-start index
- support offset, slice, replace-range, and line/column lookup
- defer piece table or rope complexity until profiling proves it is necessary

Why:

- note-sized markdown documents do not justify advanced text structures by default
- simpler buffer behavior makes round-trip bugs easier to debug
- the abstraction preserves an upgrade path if profiling later demands it

### 2. Lossless CST

The CST is the editing model.

It preserves:

- exact ranges
- delimiter ownership
- trivia ownership
- source-shape metadata
- malformed/incomplete regions
- unsupported but preserved regions

The detailed CST contract lives in `cst.md`.

### 3. View projection

The rendered editor is a projection derived from the CST.

It is optimized for:

- block layout
- inline styling
- caret navigation
- decorations
- DOM mapping

The projection is disposable and may be rebuilt after transactions.

## Structural mental model

Blocks remain the right rendering abstraction, but they are not sufficient as the sole document abstraction.

The correct split is:

- a tree for source and structural ownership
- a block/inline projection for rendering and interaction

This matters because markdown is not flat. Lists, blockquotes, tables, details blocks, and similar constructs create nested structure that a pure top-level block model cannot represent safely.

The detailed projection design lives in `view-projection.md`.

## Layer boundaries

### Headless core

The core owns:

- source buffer
- parser
- CST
- selection model
- transactions
- serialization
- history
- clipboard normalization
- asset abstraction

The core must not know about:

- Tauri
- Limestone vault layout
- filesystem persistence rules
- Svelte components
- browser DOM implementation details beyond adapter contracts

### UI adapter

The UI layer owns:

- DOM rendering
- keyboard and pointer wiring
- browser selection reconciliation
- IME event handling
- component styling
- decorations and popovers

The UI layer must not bypass the core and mutate document state directly.

## Source fidelity policy

Lossless preservation applies to the loaded document, not to arbitrary external clipboard bytes.

### Invariants

- serialize-without-edit must reproduce the exact original file bytes when file metadata is known
- outside the command blast radius, source must remain byte-identical
- syntax variants chosen by the author should be preserved when feasible
- unsupported syntax must be preserved rather than normalized away

### Text and file policy

The editor should treat file-level fidelity explicitly.

#### Newline policy

- preserve original newline style if the loaded file is known to use `LF` or `CRLF`
- for newly created documents with no source history, default to `LF`
- normalize inserted pasted line breaks to the current document newline style on insertion

#### Final newline policy

- preserve whether the original file ended with a trailing newline
- new documents may follow a host-configurable default, but that is a save policy, not an editor parsing policy

#### BOM policy

- preserve BOM if present on load
- never add a BOM if absent unless the host explicitly requests it at save time

#### Unicode policy

- do not silently normalize unicode into NFC or NFD
- preserve JS string contents exactly as loaded and edited
- if pasted content introduces different normalization forms, preserve the pasted code points rather than rewriting them

#### Tabs and spaces

- preserve literal tab characters unless the user explicitly edits or transforms them
- do not normalize indentation characters as an incidental side effect of parsing or serialization

## Compatibility contract

The product goal is broader than formal GFM alone.

The editor must distinguish between:

- CommonMark / GFM grammar
- GitHub-rendered product behaviors
- host-aware behaviors that require repository or app context

The authoritative feature-level contract lives in `compatibility-matrix.md`.

## Parser strategy

The editor should use a custom two-pass recursive-descent parser that produces the CST directly.

### Why a custom parser

The CST contract demands exact source ownership, trivia assignment, delimiter accounting, and recovery nodes. Third-party markdown parsers (micromark, marked, markdown-it, etc.) produce either HTML output or abstract syntax trees that discard this information. Adapting any of them to reconstruct full source ownership would amount to writing a second parser on top of the first — the same engineering cost with an additional impedance mismatch and a dependency that would eventually need replacing.

A custom parser:

- produces CST nodes directly, with no adapter layer
- gives full control over trivia ownership and delimiter accounting
- can be designed for incremental container-level re-entry from day one
- removes a third-party dependency from the critical parsing path
- makes the parser testable against CommonMark and GFM test suites as a first-class deliverable

### Two-pass design

The parser follows the CommonMark-specified two-pass structure.

#### Pass 1: block structure

Walk lines of the source, identifying:

- container open/close (blockquotes, list items)
- leaf blocks (paragraphs, ATX headings, setext headings, code fences, thematic breaks, tables, HTML blocks)
- lazy continuation lines
- blank line trivia

This pass produces a block-level CST skeleton with source ranges, delimiter tokens, and trivia assignments.

#### Pass 2: inline content

For each text-bearing leaf block, parse inline content:

- emphasis/strong delimiter runs with full accounting
- inline code spans
- links and images (including nested bracket resolution)
- autolinks
- strikethrough
- hard line breaks
- escape sequences

This pass populates inline children within text-bearing CST nodes.

### Validation strategy

- validate block structure against the CommonMark spec examples (~600 cases)
- validate against the GFM spec extension examples
- validate source round-trip on every test case
- maintain an additional corpus of edge cases specific to the CST contract (trivia ownership, delimiter ambiguity, recovery regions)

### Parser acceptance bar

The parser is the most expensive single investment in the editor. To prevent it from becoming an endless perfection sink, the acceptance criteria must be explicit.

#### Mandatory for v1 (must parse correctly for rich editing)

These CommonMark spec sections must pass with correct CST structure and exact round-trip:

- thematic breaks
- ATX headings
- fenced code blocks
- paragraphs
- blank lines
- block quotes
- list items and lists
- backslash escapes
- code spans
- emphasis and strong emphasis
- links
- images
- autolinks
- hard line breaks
- soft line breaks
- textual content

GFM extensions that must pass:

- strikethrough
- task list items
- autolinks (extended)

#### Mandatory for preservation (must round-trip but not rich-edit)

These must parse enough for correct byte-exact round-trip and minimal rendering, but structural editing support is not required:

- setext headings
- indented code blocks
- tables
- raw HTML blocks and inline HTML
- reference links and definitions

#### Acceptable as opaque/recovery fallback in v1

These may fall back to opaque preservation if full structural parsing is not ready:

- footnotes
- math blocks and inline math
- alert/admonition syntax
- details/summary blocks
- emoji shortcodes

#### Blocker criteria

- any spec test failure that causes **source byte loss or corruption** is a Phase 0 blocker
- any spec test failure that causes **incorrect block/inline classification** for v1 rich-editable syntax is a Phase 1 blocker
- spec test failures affecting **preserve-only syntax rendering** are tracked but non-blocking for Phase 1
- spec test failures for **opaque-fallback syntax** are non-blocking

#### When the parser is "v1-ready"

The parser is considered v1-ready when:

- all mandatory spec sections pass with correct round-trip
- all preserve-only spec sections round-trip correctly
- no known source-corruption bugs exist for any syntax
- the CST ownership invariants from `cst.md` hold on all passing test fixtures

### Incremental design from day one

Even though v1 uses full-document reparse, the block pass should be structured so that a container node can be re-entered at a known line offset. This makes future incremental parsing a localized optimization rather than an architectural retrofit.

### Risks specific to a custom parser

- CommonMark emphasis parsing rules are notoriously subtle; the spec test suite is the primary mitigation
- lazy continuation and list looseness/tightness are easy to get wrong; targeted test cases are required early
- GFM extensions (tables, strikethrough, autolinks, task lists) add surface area beyond CommonMark
- the parser is a long-term investment — expect iterative hardening as real documents expose edge cases

## Serialization strategy

Serialization is patch-based, not whole-document normalization.

The command flow is:

1. accept a transaction against logical editor state
2. compute a conservative serialization blast radius
3. reserialize that owned region
4. splice the region into the source buffer
5. reparse according to the current parser strategy
6. rebuild projections and reconcile selection

### Serialization blast radius

Every transaction must produce a conservative owned region.

Rules:

- outside the blast radius, bytes must remain untouched
- if a command cannot confidently produce a safe local blast radius, it must widen the region
- if the command still cannot guarantee correctness, it must fall back to a broader raw source operation or full-document patch

Typical radius wideners include:

- list looseness/tightness
- blockquote continuation
- setext underline ambiguity
- fenced block opening/closing
- reference definition association
- table row interpretation

## Reparse strategy

V1 default:

- full-document reparse after each committed transaction
- reuse IDs and cached view data only where unchanged nodes can be proven stable

Why this is the right v1 tradeoff:

- markdown block parsing is context-sensitive
- correctness matters more than premature incrementalism
- expected note sizes make full reparses reasonable

The custom parser's block pass should be structured with container-boundary re-entry points so that incremental parsing becomes a localized optimization when profiling demands it. This is not a v1 deliverable, but the parser architecture must not preclude it.

### Keystroke batching

Even with full reparse, the editor should batch rapid input events:

- apply source buffer splices immediately on input
- coalesce reparse, projection rebuild, and DOM commit into a single animation frame
- if multiple keystrokes arrive within one frame, reparse only once at the end

This keeps the input pipeline responsive without requiring incremental parsing in v1.

## Data flow walkthrough

These examples trace a user action through every layer to show how the components compose.

### Keystroke: user types 'a' in a paragraph

1. **Browser event**: `beforeinput` fires with `inputType: "insertText"`, `data: "a"`
2. **UI adapter**: reads current DOM selection, maps it to a logical selection (paragraph node, text offset)
3. **Transaction creation**: core creates an `InsertText` transaction targeting the logical position
4. **Source buffer splice**: the character is inserted at the corresponding source offset
5. **Reparse**: full-document reparse produces a new CST from the updated source buffer
6. **ID reconciliation**: unchanged nodes outside the affected paragraph keep their IDs; the affected paragraph node is matched by kind and position and reuses its ID with updated range
7. **Projection rebuild**: the view projection is rebuilt from the new CST; only the affected block's projection node changes
8. **DOM commit**: the renderer diffs and patches the DOM for the affected block
9. **Selection reconciliation**: the logical selection (now at offset + 1) is mapped back to a DOM position and set
10. **History**: the transaction's inverse splice is recorded for undo

### Structural command: toggle heading on a paragraph

1. **Command dispatch**: host or toolbar calls `dispatch({ type: 'toggleHeading', level: 2 })`
2. **Blast radius**: the command identifies the target paragraph as the serialization region
3. **CST mutation**: the paragraph node is replaced with a heading node; a `## ` prefix token is prepended to the serialized region
4. **Source buffer splice**: the serialized heading replaces the paragraph's source range
5. **Reparse**: full reparse confirms the heading is correctly parsed
6. **Projection rebuild**: the block projection node changes from paragraph to heading type
7. **DOM commit**: the renderer replaces the paragraph element with a heading element
8. **Selection reconciliation**: selection is mapped into the heading's text content at the equivalent offset
9. **History**: the transaction is pushed as a single undo group with the inverse splice

## Performance targets

These are v1 engineering budgets, not just aspirations.

### Target workloads

- typical note: up to 50KB
- large note: up to 200KB / 5,000 lines
- stretch case: around 1MB, with degraded but still usable behavior acceptable

### Latency goals

- median keystroke-to-paint under 16ms on typical notes
- under 50ms for large notes

### Measurement guidance

Track at least:

- input event to transaction completion
- transaction completion to DOM commit
- DOM commit to next paint where measurable
- full reparse cost alone
- CST-to-view projection cost alone

Measure median and p95 on stable fixtures and representative desktop hardware.

## Scope boundaries

V1 is explicitly:

- single-user
- local-first
- non-collaborative

Out of scope for v1:

- CRDTs
- real-time collaboration
- network merge semantics
- generalized plugin runtime

## Accessibility stance

Full accessibility support is not a v1 feature deliverable, but structural decisions now must not preclude it.

V1 requirements:

- use a single `contenteditable` root so browser accessibility primitives (screen reader cursor, keyboard navigation) work by default
- use semantic HTML elements where practical (headings as `<h1>`–`<h6>`, lists as `<ul>`/`<ol>`, etc.)
- do not suppress default keyboard navigation unless the editor provides an equivalent

Deferred to post-v1:

- explicit ARIA role annotations for custom widgets (toolbars, popovers, block handles)
- screen reader announcements for structural changes
- high-contrast and reduced-motion support

The choice of a single contenteditable root (see `input-selection.md`) is partly motivated by accessibility: it gives the browser the best chance to provide correct assistive technology integration without custom ARIA work.

## Minimal extension seams for v1

The design should preserve only a few extension seams initially:

- command registration
- decoration providers
- paste/import hooks

Anything richer should wait until the core invariants are stable.

## Key risks

- the custom parser is a significant engineering investment; CommonMark emphasis and list parsing are notoriously edge-case-heavy, and the spec test suites are the primary safety net
- selection, caret, and IME behavior remain a primary implementation risk
- CST ownership and ID remapping rules are easy to get subtly wrong
- the single contenteditable root gives us native selection and IME, but we must fight browser-invented mutations aggressively
- tables and nested structures are likely complexity sinks and must stay scoped down in v1
- the offset-based model is not collaboration-friendly, which is acceptable for v1 but a future constraint

## Package direction

Initial in-repo structure should be extraction-friendly.

```text
src/lib/editor/
  core/
  svelte/
  test/
```

Longer term this should split naturally into:

```text
packages/editor-core
packages/editor-svelte
packages/editor-testkit
```
