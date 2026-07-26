# <img width="3840" height="1020" alt="image" src="https://github.com/user-attachments/assets/e64a6afd-2b98-4d51-8e6c-654694027855" />

> [!WARNING]
> Limestone is still in pre-release state, expect bugs. Also, the editor migration is still underway to Daniel's aragonite in-house editor.

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

Pick up a rebuilt aragonite. Plain `npm install` will not notice it — the version string
is unchanged, so npm has nothing to compare. Restart any running dev server afterwards;
Vite does not watch `node_modules`.

```bash
npm run editor:sync
```

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
