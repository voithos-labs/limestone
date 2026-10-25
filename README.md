# <img width="3840" height="1020" alt="image" src="https://github.com/user-attachments/assets/e64a6afd-2b98-4d51-8e6c-654694027855" />

> [limestone.app](https://limestone.app/), [voithoslabs.com](https://voithoslabs.com/)

**Note taking, tasks, projects, etc. all local, all markdown `.md`, no account needed.**

## Monthly major updates

<img width="1319" height="805" alt="image" src="https://github.com/user-attachments/assets/452a9f6e-4622-4c71-931b-ad710572b27e" />


## We are looking for macOS and Linux testers!

Want the incredible honour of being listed as a contributor (a digital, somewhat worthless status), in exchange for your
free labor? Start today by downloading and sending us all your issues and concerns!

## Details

Limestone is entirely local, and all its data lives in markdown, json, and some binary files (edit history). The DB is a rebuildable cache.

The rich markdown editor is [aragonite](https://github.com/voithos-labs/aragonite), our in-house solution.

## Development

Good entry point to explore the code base is the SQLite schema ([see file](https://github.com/voithos-labs/limestone/blob/main/src-tauri/sql/schema.sql)), as well as `src/lib/models` ([see folder](https://github.com/voithos-labs/limestone/tree/main/src/lib/models)).

---

Run dev app

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

(a copy, not a symlink. A symlink puts aragonite's own node_modules on the type path and you end up with two sveltes
arguing over what a `Snippet` is.) Don't commit the package.json and lockfile changes that leaves behind.

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

(all featured art is made by humans, let bots write code)
