# Compatibility Matrix

This document defines the product contract for syntax support.

The key distinction is:

- **Preserve source** - whether the editor must round-trip the syntax without loss
- **Render in editor** - whether the editor should show a meaningful rendered form instead of only raw fallback
- **Rich-editable in v1** - whether the user can edit the syntax through native rich editing workflows in the first meaningful version
- **Target GitHub-like render** - whether the rendered result should aim to visually match GitHub semantics
- **Needs host/platform context** - whether correct behavior depends on app/repo/runtime context outside pure markdown parsing

## Status legend

- **Yes** - first-class support
- **Minimal** - preserve and render with limited affordances or raw-edit fallback
- **No** - not supported as a dedicated feature in v1
- **Optional** - host may provide extra behavior, but the editor core does not require it
- **Yes (host)** - requires host/platform help for full behavior

## V1 matrix

| Syntax / behavior | Preserve source | Render in editor | Rich-editable in v1 | Target GitHub-like render | Needs host/platform context | Notes |
|---|---|---|---|---|---|---|
| Paragraphs | Yes | Yes | Yes | Yes | No | Core text block |
| ATX headings | Yes | Yes | Yes | Yes | No | First-class heading editing |
| Setext headings | Yes | Minimal | No | Yes | No | Preserve exact underline style; upgrade later |
| Emphasis / strong | Yes | Yes | Yes | Yes | No | Includes nested inline formatting where supported |
| Strikethrough | Yes | Yes | Yes | Yes | No | Formal GFM extension |
| Inline code | Yes | Yes | Yes | Yes | No | Plain-text island semantics |
| Fenced code blocks | Yes | Yes | Yes | Yes | No | Code body is plain text, not inline markdown |
| Blockquotes | Yes | Yes | Yes | Yes | No | Structural editing supported |
| Ordered / unordered lists | Yes | Yes | Yes | Yes | No | Preserve marker style and numbering |
| Task lists | Yes | Yes | Yes | Yes | No | Checkbox UI tied to markdown syntax |
| Links | Yes | Yes | Yes | Yes | Optional | Host may augment navigation behavior |
| Images | Yes | Yes | Yes | Yes | Optional | Host may augment preview/import behavior |
| Reference links / definitions | Yes | Minimal | No | Yes | No | Preserve definitions exactly; raw/minimal editing first |
| Thematic breaks | Yes | Yes | Yes | Yes | No | Atomic block |
| Hard line breaks | Yes | Minimal | Yes | Yes | No | Enter semantics may generate them intentionally |
| Autolinks (bare URL/email) | Yes | Yes | Yes | Yes | No | Formal GFM behavior |
| Escape sequences | Yes | Minimal | Yes | Yes | No | Usually edited through text operations rather than custom UI |
| Tables | Yes | Minimal | No | Yes | No | Preserve + render only in v1; no rich cell editor yet |
| Raw HTML blocks / inline HTML | Yes | Minimal | No | Minimal | No | Preserve exactly; raw-edit fallback |
| Footnotes | Yes | Minimal | No | Minimal | No | Preserve and optionally render references |
| Math | Yes | Minimal | No | Minimal | No | Preserve; rendered math may depend on chosen renderer |
| Alerts | Yes | Minimal | No | Yes | No | GitHub-style admonition rendering is a product feature, not formal GFM |
| Details / summary blocks | Yes | Minimal | No | Yes | No | Preserve + minimal rendered disclosure |
| Emoji shortcodes | Yes | Minimal | No | Yes | No | Preserve raw shortcode even if rendering an emoji preview |
| GitHub issue / PR / mention / SHA autolinks | Yes | Minimal | No | Yes | Yes (host) | Full behavior depends on repository/user context |

## V1 ship line

The first meaningful editor version should treat these as first-class rich-editable syntax:

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
- autolinks

Everything else above still must preserve source when loaded, but may use minimal rendering or raw-edit fallbacks.

## Formal GFM vs GitHub-rendered behavior

### Formal GFM core for this project

These are closest to the standards-based core:

- paragraphs
- headings
- emphasis / strong
- inline code
- fenced code
- blockquotes
- lists
- task lists
- tables
- strikethrough
- autolinks
- hard line breaks
- thematic breaks
- escapes

### GitHub-rendered product behaviors

These are supported because users expect GitHub-like authoring, not because they are formal GFM grammar in every case:

- alerts
- details blocks
- emoji shortcodes
- footnotes
- math rendering
- repository-aware autolinks

### Host-aware behaviors

These need app or repository context outside markdown parsing:

- issue / PR / mention / SHA resolution
- image preview or local asset import
- link-following behavior
- save and conflict behavior

## Change policy

No syntax should move from preserve-only to rich-editable without an explicit addition to:

- this matrix
- `plan.md`
- any affected CST or input-selection contract
