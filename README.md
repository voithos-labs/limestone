# <img width="3840" height="1020" alt="image" src="https://github.com/user-attachments/assets/e64a6afd-2b98-4d51-8e6c-654694027855" />

> [!WARNING]
> Limestone is still in pre-release state, expect bugs. The editor migration is still underway, swapping over to Daniel's in-house aragonite editor.
> <img width="1120" height="469" alt="image" src="https://github.com/user-attachments/assets/92ee945e-a479-4681-9a4d-5247ebfb85f2" />

Note taking etc., built for people who think clearly when their tools get out of the way.

<img width="1019" height="691" alt="image" src="https://github.com/user-attachments/assets/254cff31-24d8-49ac-b3a2-16051cc4634e" />

## Development

Good entry point to explore the code base is Session ([see file](https://github.com/voithos-labs/limestone/blob/main/src/lib/models/Session.svelte.ts)), as well as `src/lib/models` ([see folder](https://github.com/voithos-labs/limestone/tree/main/src/lib/models)).

---

Currently, the editor library is not on the npm registry. Thus we have to do a bit of setup for local dev:

```bash
git clone https://github.com/voithos-labs/aragonite.git ../aragonite
cd ../aragonite
npm i && npm run package
cd ../limestone
npm i
```

Then:

```bash
npm run tauri dev
```

Since aragonite is also actively under dev, so sometimes you have to rebuild it with `npm run package` after new changes. To pick up on the new build, run:

```bash
npm run editor:sync
```

Also, if you are developing both limestone and aragonite on the same machine, note that aragonite's showcase dev server also uses port 1420. So, if you are stupid enough to run both the showcase dev server and limestone's npm test at the same time, try to avoid port collision with:

```bash
PORT=1425 npm test
```

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
