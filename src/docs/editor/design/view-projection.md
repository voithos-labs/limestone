# View Projection

This document defines the view projection layer that bridges the CST and the DOM.

## Purpose

The view projection transforms the CST into a rendering-oriented structure. The CST is optimized for source preservation; the projection is optimized for layout, styling, interaction, and efficient DOM updates.

The projection is disposable. It is rebuilt after transactions and must never be treated as canonical state.

## Why a separate layer

The CST and the DOM serve fundamentally different goals:

- the CST must own every source byte, track trivia, and preserve malformed regions
- the DOM must present a clean editing surface with styled text, atomic widgets, and navigable structure

Forcing the renderer to walk the CST directly would entangle rendering logic with source-preservation bookkeeping. The projection is a clean intermediate that decouples the two.

## Projection structure

### Block projection

The projection produces a flat sequence of renderable block descriptors from the CST.

Each block descriptor carries:

- a stable key derived from the CST node ID
- a block kind (paragraph, heading, code fence, list item, blockquote wrapper, thematic break, table, opaque, etc.)
- nesting depth and container context (list nesting level, blockquote depth)
- content: either an inline run sequence for text-bearing blocks, or raw source for opaque blocks
- metadata: heading level, code fence language, list marker style, checkbox state, etc.
- decoration slots for host-provided annotations

### Structural ancestry

The projection is rendered as a flat block stream, but structural ancestry must remain cheaply accessible. Each block descriptor carries its container context (nesting depth, list/quote ancestry). This is sufficient for rendering, but command routing, accessibility semantics, and structural selection may also need to walk ancestry.

The rule: **flatten for rendering, but do not discard hierarchy where it still matters.** Specifically:

- commands that operate on containers (unwrap blockquote, dedent list item) need to know the container chain
- accessibility roles for nested lists and blockquotes need ancestry information
- structural selection across nested containers needs to resolve containment

The `ContainerContext` on each block descriptor and the CST itself (which is always available) together satisfy this. The projection does not need to duplicate a full tree, but callers must not assume that flatness means hierarchy is irrelevant.

### Inline projection

Within text-bearing blocks, inline content is represented as a flat sequence of styled runs.

Each run carries:

- text content
- a set of active marks (bold, italic, strikethrough, code, link, etc.)
- source range back-reference for selection mapping
- whether the run is editable text or an atomic inline (image, etc.)

Why flat runs instead of nested spans:

- DOM rendering is simpler with flat spans that carry mark sets
- selection mapping is a straightforward offset-to-run lookup
- decoration merging is easier when marks are sets rather than tree nesting
- this is the same model ProseMirror and similar editors use, and it is proven at scale

### Atomic and void blocks

- images produce atomic inline nodes within their parent block's run sequence
- thematic breaks produce void block descriptors with no inline content
- code fence bodies produce plain-text block descriptors with no inline parsing
- opaque/recovery regions produce raw-source block descriptors

## Derivation from CST

The projection is derived by a depth-first walk of the CST:

1. container nodes (blockquote, list, list item) establish nesting context
2. leaf nodes produce block descriptors
3. inline children of text-bearing leaves produce run sequences
4. opaque/recovery nodes produce opaque block descriptors with raw source content
5. trivia (blank lines between blocks) may produce spacing hints but are not rendered as distinct blocks

The walk is stateless beyond the current nesting context. No global passes or lookahead should be required.

## DOM mapping

The UI layer maintains a bidirectional map between:

- block descriptor keys and DOM block elements
- inline run indices and DOM text nodes within a block
- atomic node boundaries and DOM element boundaries

This map is rebuilt after each DOM commit and used by the selection reconciliation loop described in `input-selection.md`.

### Mapping granularity

- block level: one DOM element per block descriptor, keyed by the descriptor's stable key
- inline level: one DOM `<span>` per inline run within a text-bearing block
- atomic level: one DOM element per atomic inline (image, etc.), with `contenteditable="false"`

## Dirty tracking

After a transaction, the projection rebuild should identify which block descriptors changed:

- compare new projection blocks against previous projection blocks by stable key
- blocks with matching keys and identical content, marks, and metadata are stable
- only changed or new blocks trigger DOM updates

V1 may use a simple full-projection rebuild with key-based comparison. The Svelte keyed `{#each}` block handles DOM diffing efficiently for the common case where most blocks are stable.

Future optimization: if profiling shows projection rebuild is costly, the CST diff (which nodes changed IDs or ranges) can be used to limit the projection walk to affected subtrees.

## Decoration merging

Host-provided decorations (diagnostics, search highlights, selection-linked markers) are merged into the projection as additional marks on inline runs or additional metadata on block descriptors.

Decorations do not modify the CST or source buffer. They are layered onto the projection during the derivation pass.

### Merge rules

- a decoration that spans part of an inline run splits the run at the decoration boundary
- multiple overlapping decorations produce a run with the union of all active marks and decoration types
- block-level decorations (e.g., a warning gutter icon) attach to the block descriptor's decoration slot

## Conceptual types

These are contract sketches, not final API.

```ts
interface BlockProjection {
  key: string;
  kind: BlockKind;
  depth: number;
  containerContext: ContainerContext;
  content: InlineRun[] | RawContent;
  metadata: BlockMetadata;
  decorations: BlockDecoration[];
}

interface InlineRun {
  text: string;
  marks: Set<MarkType>;
  sourceRange: SourceRange;
  atomic?: AtomicInlineDescriptor;
  decorations: InlineDecoration[];
}

interface ContainerContext {
  listDepth: number;
  quoteDepth: number;
  listKind?: 'ordered' | 'unordered';
  taskItem?: boolean;
}
```

## Relationship to other design docs

- `cst.md` defines the source of truth the projection derives from
- `input-selection.md` defines how the projection's DOM mapping supports selection and reconciliation
- `architecture.md` defines when the projection is rebuilt in the transaction data flow
- `undo-redo.md` defines history; the projection is not involved in undo (it is rebuilt from the CST after any state change)

## Non-goals

- the projection is not a public API; hosts interact through the module API in `api.md`
- the projection does not store undo history or canonical state
- the projection does not attempt to be framework-agnostic; the Svelte renderer is the only consumer in v1
