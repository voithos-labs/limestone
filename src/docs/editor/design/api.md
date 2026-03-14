# Module API and Host Boundary

This document defines the reusable module boundary for the editor.

## Goals

The API should:

- keep markdown canonical
- keep persistence outside the editor
- support extraction into a standalone package
- expose enough state and commands for host integration
- avoid forcing Limestone-specific concepts into the core

## Ownership model

The editor should use a **hybrid ownership model**.

### Why hybrid

A fully controlled model is awkward for high-frequency editing because the host would need to round-trip the whole document on every keystroke.

A fully uncontrolled model is awkward for reusable integration because the host still needs to save, replace documents, dispatch commands, and provide diagnostics.

### Hybrid contract

- the host provides the initial document and integration callbacks
- the editor owns the live in-memory editing session state
- the host can explicitly load or replace a document through a document API
- the editor emits change and save events outward

## API layers

The public boundary should be thought of in three layers.

### 1. Document state API

The host needs to:

- initialize the editor with markdown and metadata
- replace the current document intentionally
- inspect snapshots when needed
- observe dirty state and revision state

Conceptual shape:

```ts
interface EditorDocumentInput {
  documentKey: string;
  markdown: string;
  encoding?: FileEncodingMetadata;
  version?: string;
  assets?: EditorAssetContext;
}

interface EditorSnapshot {
  documentKey: string;
  markdown: string;
  dirty: boolean;
  version?: string;
  selection: EditorSelection;
}
```

### 2. Command API

The host should be able to invoke editor behavior without reaching into internal state.

Conceptual examples:

- `dispatch(command)`
- `focus()`
- `setSelection(selection)`
- `loadDocument(input)`
- `requestSave()`
- `getSnapshot()`

### 3. Host integration API

The host provides:

- change callbacks
- save callbacks
- link following behavior
- asset resolution and import behavior
- diagnostics and decorations

## Change contract

One callback is not enough for all needs.

The editor should distinguish between:

### High-frequency transaction/change events

These are for UI integration, dirty state, and telemetry.

Conceptual payload:

```ts
interface EditorChangeEvent {
  documentKey: string;
  dirty: boolean;
  selection: EditorSelection;
  changedRange?: SourceRange;
  summary: TransactionSummary;
}
```

### Snapshot access

When the host needs the full markdown string, it should be able to ask for a snapshot.

This avoids forcing the public API to push a full document string through every high-frequency event if that becomes costly.

## Save contract

Persistence belongs to the host.

### Save flow

1. host or user triggers save
2. editor creates a save payload from current canonical markdown state
3. payload includes document identity and base version if known
4. host persists it and returns success or conflict outcome

Conceptual shape:

```ts
interface SavePayload {
  documentKey: string;
  markdown: string;
  version?: string;
  dirty: boolean;
}

interface SaveResult {
  ok: boolean;
  newVersion?: string;
  conflict?: ExternalConflict;
}
```

### Conflict rule

If the host detects an external change conflict:

- the editor should not silently overwrite state assumptions
- the host should explicitly decide whether to reload, merge, or surface a conflict UI
- the editor must support intentional document replacement after conflict resolution

## External document replacement

The host must be able to replace the whole document, but only intentionally.

Rules:

- document replacement should happen through `loadDocument` or an equivalent explicit API
- if the current document is dirty, the host should decide whether to block, confirm, or replace anyway
- implicit prop drift should not unexpectedly reset live editor state

## Document session model

The editor should maintain a minimal session state model so that save, conflict, and external replacement behavior is concrete rather than ad hoc.

### Session state

```ts
interface DocumentSession {
  documentKey: string;
  loadedVersion?: string;
  lastSavedVersion?: string;
  dirty: boolean;
  externalChangeDetected: boolean;
  conflictPending: boolean;
}
```

### State transitions

- **load**: sets `loadedVersion`, clears `dirty`, clears `externalChangeDetected`, clears `conflictPending`
- **edit**: sets `dirty` to true
- **save success**: updates `lastSavedVersion`, clears `dirty`
- **save conflict**: sets `conflictPending` to true; the host decides resolution
- **external change detected**: sets `externalChangeDetected` to true; the host decides whether to reload, merge, or prompt
- **host replaces document**: equivalent to a new load; resets all session state

### Host responsibilities

- the host is responsible for detecting external changes (e.g., file watcher, vault refresh)
- the host decides conflict resolution policy; the editor exposes state, not policy
- the editor must not silently reload or discard dirty state

### Editor responsibilities

- the editor tracks dirty state accurately across all transactions and undo/redo operations
- the editor exposes session state through the snapshot API
- after a full undo back to the last-saved state, `dirty` should return to false

## Diagnostics and decorations

The host should be able to supply non-source annotations.

Examples:

- unresolved link warning
- missing asset warning
- lint messages
- search highlights
- selection-linked decorations

These must remain separate from canonical markdown.

Conceptual shape:

```ts
interface EditorDiagnostic {
  range: SourceRange;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

interface DecorationProvider {
  getDecorations(snapshot: EditorSnapshot): Decoration[];
}
```

## Asset and link integration

The editor should not know anything about vault semantics.

Conceptual shape:

```ts
interface EditorAssetContext {
  resolveLink?: (destination: string) => Promise<ResolvedLink | null> | ResolvedLink | null;
  importAsset?: (file: File, context: AssetImportContext) => Promise<ImportedAsset>;
}

interface EditorCallbacks {
  onChange?: (event: EditorChangeEvent) => void;
  onSaveRequest?: (payload: SavePayload) => Promise<SaveResult> | SaveResult;
  onFollowLink?: (destination: string) => void;
}
```

## Asset paste and drop flow

When the user pastes or drops an image (or other file asset) into the editor:

1. **Editor intercepts**: the `beforeinput` handler receives `insertFromPaste` or `insertFromDrop` with file data
2. **Placeholder insertion**: the editor inserts a placeholder image node at the target position (e.g., `![Uploading...](placeholder)`), allocates a stable session-only `pendingImportId`, and commits it as a transaction
3. **Asset adapter call**: the editor calls `importAsset` from the host-provided `EditorAssetContext`, passing the file and positional context
4. **Host processing**: the host saves the file to the vault asset folder (or equivalent), and returns the markdown-relative path and alt text
5. **Placeholder replacement**: the editor replaces the placeholder with the final image syntax (e.g., `![photo](assets/photo.png)`) as a second transaction
6. **Undo grouping**: the placeholder insertion and replacement are grouped as a single undo entry

If the host's import fails:

- the placeholder node is removed (undone)
- the editor may surface a diagnostic through the decoration system
- the user's document returns to the pre-paste state

This flow keeps file system and vault logic entirely in the host while giving the editor a responsive paste experience. The editor never needs to know where or how assets are stored.

### Edge cases

- **Cancellation**: if the user undoes while the import is in-flight, the editor removes the placeholder immediately. When the host's `importAsset` promise resolves, the editor ignores the result because the placeholder no longer exists. The host should handle any cleanup (e.g., deleting the already-saved file) on its own if notified.
- **Undo during import**: if the user undoes the placeholder insertion before the import completes, the undo removes the placeholder. The import result is discarded. The undo group is treated as a normal undo of a text insertion.
- **Pasted HTML containing images**: if pasted HTML includes `<img>` tags, the HTML-to-markdown conversion should produce `![alt](src)` syntax. If the `src` is a remote URL, it is inserted as-is. If the `src` is a blob or data URL, it should be routed through the `importAsset` pipeline as if the user pasted a file.
- **Placeholder identity after reparse**: the placeholder is a normal image node in the CST. After reparse, it is matched by the standard ID reuse rules. The editor tracks the pending import primarily by the stable session-only `pendingImportId`, while also maintaining a remapped source-range anchor to relocate the placeholder after reparses and nearby edits. Node ID remains best-effort only.
- **V1 scope**: only image files are supported through the asset import pipeline in v1. Non-image file drops should be ignored or produce a link to the file if the host supports it.

## Controlled things vs uncontrolled things

### Host-controlled

- document load / replacement
- save lifecycle
- diagnostics
- decorations
- asset resolution/import behavior
- external command dispatch

### Editor-controlled

- live transaction stream
- undo/redo stack
- temporary selection state
- transient composition state
- DOM reconciliation state

## Minimal extension surface for v1

The public reusable surface should stay small.

V1 should support:

- host command dispatch
- decorations/diagnostics
- paste/import hooks

V1 should not attempt a generalized plugin runtime.

## Non-goals

This API does not attempt to solve:

- multi-user synchronization
- CRDT document merging
- network transport
- repo-aware GitHub autolink resolution inside the core

Those remain host responsibilities or future work.
