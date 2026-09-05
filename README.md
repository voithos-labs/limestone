# <img width="3840" height="1020" alt="image" src="https://github.com/user-attachments/assets/e64a6afd-2b98-4d51-8e6c-654694027855" />

> [!WARNING]
> Limestone is still in pre-release state, expect bugs. The editor just swapped over to Daniel's in-house aragonite editor, so that part is the newest and prob the roughest.
> <img width="1120" height="469" alt="image" src="https://github.com/user-attachments/assets/92ee945e-a479-4681-9a4d-5247ebfb85f2" />

Note taking etc., built for people who think clearly when their tools get out of the way.

<img width="1019" height="691" alt="image" src="https://github.com/user-attachments/assets/254cff31-24d8-49ac-b3a2-16051cc4634e" />

## Editor

The editor is [aragonite](https://github.com/voithos-labs/aragonite), the block editor we wrote for this, and it comes from npm now (`@voithos-labs/aragonite`). The old CodeMirror editor is gone. Things worth knowing:

- A note has three views, Source, Live and Reading. Toggle at the top right of the document, or `Ctrl+E` to cycle. Which one a new tab opens in is a setting under Appearance.
- Live hides the markdown, so it gets a small formatting bar when you select text, and a `+` beside the toggle for tables, code blocks, callouts, math, diagrams and dividers.
- Images are Obsidian style, `![[cat.png]]`. Paste an image and it's saved into the source's asset folder and embedded for you.
- `Ctrl+F` finds, `Ctrl+H` replaces, `Ctrl+=` and `Ctrl+-` zoom.

Everything else about the editor (every shortcut, plugins, theming) is in aragonite's [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md). A copy ships in the package too, under `node_modules/@voithos-labs/aragonite/docs/guide/`.

## Development

Good entry point to explore the code base is Session ([see file](https://github.com/voithos-labs/limestone/blob/main/src/lib/models/Session.svelte.ts)), as well as `src/lib/models` ([see folder](https://github.com/voithos-labs/limestone/tree/main/src/lib/models)).

---

The editor library is on npm now, so there's no setup anymore:

```bash
npm i
npm run tauri dev
```

If you're changing aragonite and limestone at the same time, build aragonite and install it here as a copy:

```bash
cd ../aragonite
npm run package
cd ../limestone
npm i --install-links ../aragonite
```

(a copy, not a symlink. A symlink puts aragonite's own node_modules on the type path and you end up with two sveltes arguing over what a `Snippet` is.) Don't commit the package.json and lockfile changes that leaves behind.

Formating:

```bash
npm run format
```

```bash
cd src-tauri
cargo fmt
```

## License

Source-available under the [Functional Source License 1.1](LICENSE.md) with an
Apache 2.0 future license (`FSL-1.1-ALv2`).

The Limestone and Voithos Labs names, logo, and icons are **not** covered by that
license. See [TRADEMARKS.md](TRADEMARKS.md) before forking or redistributing.

Peace be with you
