# Feature: the editor's theme bridge

Covers `theming.spec.ts`. `src/components/editor/editor-tokens.css` maps limestone's theme
variables onto the tokens the embedded aragonite editor reads; these scenarios pin that mapping
through the running app. The same file bridges the page column's width and the reader's zoom,
which are `page-layout.md`'s.

Assertions read resolved custom properties off the live `.editor` element rather than painted
colors: the editor root paints no background of its own, so the token is the observable the
bridge actually controls.

## Happy paths

- The editor's `--color-bg` resolves to the app's `--color-surface`, in both light and
  dark themes.
- Border, accent and text tokens on the editor resolve to the app's same-named `:root`
  values rather than to aragonite's shipped defaults.
- Markdown syntax tokens on the editor resolve to the app's `--syntax-*` palette for the
  active mode.
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
- A theme that omits a bridged variable leaves that token invalid rather than falling
  back to aragonite's default, because the bridge declaration shadows it. Each aragonite
  read carries its own inline fallback, so the surface stays legible.

## Deferred

- Tokens limestone deliberately does not bridge — aragonite's code-token palette and its
  selection/search overlays — keep aragonite's light/dark defaults and are aragonite's to cover.
- Mermaid diagrams draw their own light palette in every theme, so a diagram in a dark document is
  a bright rectangle. Choosing mermaid's theme is plausibly limestone's call (the renderer is
  injected here), but no seam exists on either side yet, so nothing pins it.
