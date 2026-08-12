# Feature: the editor's theme bridge

Covers `theming.spec.ts`. aragonite splits its variables in two. Host-contract names a themed app
already declares reach the editor through limestone's own `:root`, because aragonite defaults them
behind an opt-in class the app never sets. The rest still default on `.editor`, and
`src/components/editor/editor-tokens.css` points the ones limestone has an answer for at the app's
theme. These scenarios pin both halves through the running app. That same file sets the page
column's width, which is `page-layout.md`'s.

Assertions read resolved custom properties off the live `.editor` element rather than painted
colors: the editor root paints no background of its own, so the token is the observable the
mapping actually controls.

## Happy paths

- Surface, border, accent and text tokens resolve on the editor to the app's same-named `:root`
  values. Nothing on the editor shadows them, which is the whole of the host contract.
- Markdown syntax tokens on the editor resolve to the app's `--syntax-*` palette for the
  active mode. These are editor-owned, so they take a line in `editor-tokens.css`.
- A thematic break's rule paints the app's border colour, in both modes. aragonite colours it
  from `--syntax-separator`, which limestone picked to tint `---` glyphs inside a line of text;
  across a full-width rule the same value is the loudest thing on the page. The rule is
  retargeted rather than the token remapped, so the syntax palette keeps its meaning — asserted
  as a computed `border-top-color`, since a raw token and a painted colour are not comparable.
- The wash aragonite's table menu hovers with takes the app's own menu hover, so it follows the
  reader's theme and sits beside limestone's accent rather than aragonite's neutral tint.

## User interactions

- Switching the theme from settings: the editor's tokens take the new palette's values
  without a reload.
- Switching between a light theme and a dark one: `data-editor-theme` on the editor flips
  with it, so aragonite's own mode-keyed defaults follow the app.
- Switching between two themes of the same mode: token values change while
  `data-editor-theme` stays put.

## Edge cases

- The editor's first paint after boot already carries the app's palette — a theme is
  applied before an editor can mount, so no frame renders against aragonite's defaults.
  Pinned at the moment the editor enters the DOM, since by the time it can be located the
  evidence of a wrong first frame is gone.
- A theme that omits a host-contract variable leaves that token invalid rather than falling
  back to aragonite's default: aragonite's value for it sits behind the opt-in class, so nothing
  supplies one. Each aragonite read carries its own inline fallback, so the surface stays legible.

## Deferred

- aragonite's code-token palette stays unbridged and keeps its own light/dark values. Limestone
  has no syntax-highlighting palette to hand over, so it is aragonite's to cover.
- The selection, search-match and reorder washes mix over `--color-selection`, which limestone's
  themes set to the reader's accent, so they follow it. Only the unit drift test pins that the
  themes declare the name; the mixing is aragonite's. The active-match wash is a fixed tint of
  aragonite's own and follows nothing.
- Mermaid diagrams draw their own light palette in every theme, so a diagram in a dark document is
  a bright rectangle. Choosing mermaid's theme is plausibly limestone's call (the renderer is
  injected here), but no seam exists on either side yet, so nothing pins it.
