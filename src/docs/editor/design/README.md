# Editor Design Set

This folder contains the authoritative design documents for the Limestone editor module.

The editor remains based on four core decisions:

- markdown source is canonical
- round-tripping must be lossless for supported and preserved syntax
- rendered editing is a projection over markdown, not the document model
- the editor stays decoupled from Limestone-specific persistence and vault logic

## Why this folder exists
The design is split here so the highest-risk areas have their own contracts:

- `architecture.md` - overall architecture, custom parser strategy, source fidelity policy, serialization, data flow, performance scope
- `compatibility-matrix.md` - exact v1 contract for preservation, rendering, editability, GitHub-like rendering, and host context
- `cst.md` - lossless CST contract, token/trivia ownership rules, malformed region handling, ID reuse rules
- `view-projection.md` - view projection layer between CST and DOM, block/inline projection, dirty tracking, decoration merging
- `input-selection.md` - editable strategy, logical selection model, DOM reconciliation, IME/event handling, transient malformed state UX
- `undo-redo.md` - transaction history, undo grouping, selection restoration, compound transactions
- `editing-semantics.md` - concrete command behavior tables for v1 editing commands, fallback rules, clipboard operations
- `api.md` - reusable module boundary, hybrid ownership model, commands, save flow, asset paste/drop flow, document session model, diagnostics/decorations
- `plan.md` - phased implementation plan, explicit v1 ship line, proof-of-concept gates, operational parser acceptance bar
- `testing.md` - round-trip, patch, invariant, interaction, fuzz, and performance testing strategy

## Recommended reading order

1. `architecture.md`
2. `compatibility-matrix.md`
3. `cst.md`
4. `view-projection.md`
5. `input-selection.md`
6. `undo-redo.md`
7. `editing-semantics.md`
8. `api.md`
9. `plan.md`
10. `testing.md`

## Accepted critique changes

Compared with the earlier single-file design, this design set intentionally tightens several points:

- v1 scope is narrower, especially around tables and GitHub-specific syntax
- the distinction between formal GFM, GitHub-rendered behavior, and host-aware features is explicit
- the CST and selection/input model are treated as first-class design surfaces
- text fidelity policy now explicitly covers line endings, BOM handling, tabs, unicode normalization, and pasted text normalization
- the implementation plan adds an input harness phase before broad editing support
- extension ambitions are intentionally minimal in v1

Additional changes from senior review:

- parser strategy changed from micromark adapter to a custom two-pass recursive-descent parser that produces the CST directly, eliminating the impedance mismatch and building for long-term ownership
- view projection layer is now a first-class design surface with its own document
- undo/redo model is now explicitly designed with grouping, selection restoration, and compound transaction semantics
- editable strategy commits to a single contenteditable root with controlled rendering (ProseMirror-style), rejecting the per-block contenteditable alternative
- transient malformed state UX is now specified to prevent visual glitches during normal typing
- data flow walkthroughs trace concrete user actions through every layer
- keystroke batching is specified as a v1-acceptable performance optimization
- accessibility stance is stated: structural decisions must not preclude future accessibility work
- asset paste/drop flow is sketched end-to-end with edge cases
- Phase 3 includes an early host integration feedback loop

Additional changes from second senior review:

- editing semantics doc added with concrete command behavior tables for all v1 command families
- parser acceptance bar made operational: mandatory spec sections, preserve-only sections, opaque fallbacks, blocker criteria, and explicit "v1-ready" definition
- document session model added to API with state transitions for load, edit, save, conflict, and external change
- selection anchoring explicitly defined as source-offset-primary with splice-delta mapping after reparse
- raw-edit fallback UX specified: entry, exit, visual treatment, editing behavior, selection spanning, undo, and decorations
- view projection structural ancestry rule clarified: flatten for rendering, but hierarchy must remain accessible for commands and accessibility
- asset edge cases tightened: cancellation, undo during import, pasted HTML image routing, placeholder tracking, v1 scope

## Current implementation stance

The design is ready to proceed. Implementation should begin with the proof-of-concept gates in `plan.md`: the custom parser PoC, CST round-trip validation, and the input harness. These gates must pass before broad editing work begins.
