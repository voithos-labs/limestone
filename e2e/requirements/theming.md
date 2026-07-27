# Feature: the editor's theme bridge

Covers `theming.spec.ts`. `src/components/editor/editor-tokens.css` maps limestone's
theme variables onto the tokens the embedded aragonite editor reads; these scenarios
pin that mapping through the running app.

Written ahead of its spec: the spec lands in Task 6 of the aragonite integration, and
Task 4 is what first mounts an `.editor` for it to read.

Assertions read resolved custom properties off the live `.editor` element rather than
painted colors. The editor root paints no background of its own — `--color-bg` is what
its search bar, table menu and image panel paint with — so the resolved token, not a
screenshot pixel, is the observable the bridge actually controls.

## Happy paths

- The editor's `--color-bg` resolves to the app's `--color-surface`, in both light and
  dark themes.
- Border, accent and text tokens on the editor resolve to the app's same-named `:root`
  values rather than to aragonite's shipped defaults.
- Markdown syntax tokens on the editor resolve to the app's `--syntax-*` palette for the
  active mode.
- The block list is centered and no wider than `--page-max-width`, matching the app's
  other page surfaces.

## User interactions

- Switching the theme from settings: the editor's tokens take the new palette's values
  without a reload.
- Switching between a light theme and a dark one: `data-editor-theme` on the editor flips
  with it, so aragonite's own mode-keyed defaults follow the app.
- Switching between two themes of the same mode: token values change while
  `data-editor-theme` stays put.
- Zooming with Ctrl+= / Ctrl+-: `--editor-font-size` tracks `--ls-zoom` and the rendered
  text scales with it.

## Edge cases

- The editor's first paint after boot already carries the app's palette — a theme is
  applied before an editor can mount, so no frame renders against aragonite's defaults.
- A theme that omits a bridged variable leaves that token invalid rather than falling
  back to aragonite's default, because the bridge declaration shadows it. Each aragonite
  read carries its own inline fallback, so the surface stays legible.

## Deferred

- Tokens limestone deliberately does not bridge — aragonite's code-token palette and its
  selection/search overlays — keep aragonite's light/dark defaults and are covered by
  aragonite's own suite, not here.
