# <img width="3840" height="1020" alt="image" src="https://github.com/user-attachments/assets/e64a6afd-2b98-4d51-8e6c-654694027855" />

> [!WARNING]
> Limestone is still in pre-release state, expect bugs. The editor migration is still underway, swapping over to Daniel's in-house aragonite editor.
> <img width="1120" height="469" alt="image" src="https://github.com/user-attachments/assets/92ee945e-a479-4681-9a4d-5247ebfb85f2" />

Note taking etc., built for people who think clearly when their tools get out of the way.

<img width="1019" height="691" alt="image" src="https://github.com/user-attachments/assets/254cff31-24d8-49ac-b3a2-16051cc4634e" />

## Development

Good entry point to explore the code base is Session ([see file](https://github.com/voithos-labs/limestone/blob/main/src/lib/models/Session.svelte.ts)), as well as `src/lib/models` ([see folder](https://github.com/voithos-labs/limestone/tree/main/src/lib/models)).

---

The editor comes from a sibling [aragonite](https://github.com/voithos-labs/aragonite)
checkout rather than the registry, so clone and build it first — `npm i` here fails
without it.

```bash
git clone https://github.com/voithos-labs/aragonite.git ../aragonite
cd ../aragonite
npm i && npm run package
cd ../limestone
npm i
```

Run dev app

```bash
npm run tauri dev
```

Vite is pinned to port 1420, which an aragonite showcase dev server also takes. With one
running, `npm test` adopts it instead of starting this app and every spec fails on a page
that was never limestone. Give the suite a port of its own:

```bash
PORT=1425 npm test
```

Pick up a rebuilt aragonite, then restart any running dev server — Vite does not watch
`node_modules`. Plain `npm install` will not notice a rebuild: the version string is
unchanged, so npm has nothing to compare.

```bash
npm run editor:sync
```

The script drops Vite's dependency cache along with the package, because Vite keys the
editor's pre-bundled copy on something a rebuild does not change. Refreshing the package
alone would leave the browser running the old build — a failure that looks like the
rebuild never happened rather than like a stale file.

Format

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
