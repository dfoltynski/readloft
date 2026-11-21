<h1 align="center">Readloft</h1>

<p align="center">
  A self-hosted ebook library and reader. Point it at a folder of books, open a browser, read.
</p>

<p align="center">
  <a href="LICENSE"><img alt="license: PolyForm Noncommercial" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue"></a>
  <img alt="node 24+" src="https://img.shields.io/badge/node-24%2B-339933">
  <img alt="docker ready" src="https://img.shields.io/badge/docker-ready-2496ED">
</p>

<p align="center">
  <img src="docs/library.png" alt="Readloft library view" width="900">
</p>

## Features

- **Library**: scans a folder for EPUB, PDF, MOBI/AZW/AZW3, FB2/FBZ and CBZ and extracts title, authors, series, description and covers. Grid and list views, search, sort, "continue reading".
- **Shelves**: your own collections, plus status filters (reading, finished, unread).
- **Upload**: drag and drop files into the browser.
- **Reader**: powered by [foliate-js](https://github.com/johnfactotum/foliate-js). Paginated or scrolled, light/sepia/dark themes, fonts, size, line height, table of contents, search, bookmarks (rename them in place), and progress synced to the server.
- **Metadata**: edit metadata and set custom covers; edits survive rescans.

## How it works

```mermaid
flowchart LR
  B[(Books folder)] -->|scan| S[Server<br/>Hono + SQLite]
  S <-->|REST API| W[Web UI<br/>React + foliate-js]
  W --> U((You))
```

## Quick start (Docker)

```sh
git clone https://github.com/dfoltynski/readloft.git
cd readloft
docker compose up -d --build
# open http://localhost:8080 — put books in ./books
```

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `LIBRARY_DIR` | `./books` (`/books` in Docker) | Folder scanned for books; uploads go to `uploads/` inside it |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database and cover cache |
| `SCAN_INTERVAL_MINUTES` | `30` | Periodic rescan, `0` disables |

> No authentication yet. Don't expose it to the internet directly — put it behind a reverse proxy with auth (Authelia, Authentik, Caddy basic auth…) or on a private network (Tailscale).

## Development

Requires Node 24+ (server runs TypeScript natively, no build step) and git.

```sh
git clone https://github.com/dfoltynski/readloft.git
cd readloft
npm install
npm run setup      # vendors foliate-js into web/public/foliate-js
npm run dev        # API on :8080, web on :5173 (proxies /api)
npm run typecheck
```

### Layout

```
shared/types.ts   API contract + types shared by server and web (start here)
server/           Hono API, node:sqlite, folder scanner, metadata extractors
web/              React + Vite UI; reader wraps <foliate-view>
scripts/          setup helpers
```

## Desktop app

Download the installer for your OS (macOS `.dmg`, Windows `.exe`, Linux `.AppImage` / `.deb`) from the [Releases](../../releases) page. On first launch Readloft asks for your library folder (this can be an iCloud Drive folder); change it later from the app menu. The app runs the same server as the Docker setup, on port 8080 (or a free port if that is taken), so LAN and Tailscale access keep working.

The builds are unsigned, so your OS will warn on first run:

- macOS: right-click the app and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Readloft.app`.
- Windows SmartScreen: click More info, then Run anyway.

To cut a release, push a version tag. GitHub Actions builds all platforms and attaches them to a draft release:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Locally: `npm run desktop:dev` runs the app against the local build, `npm run desktop:dist` packages for the current OS into `desktop/release/`.

### Rebuilding the desktop app

Run from the repo root. Output goes to `desktop/release/`.

```sh
# once, and after pulling: install deps and vendor foliate-js
npm install
npm run setup

# build the web UI (always, before packaging)
npm run build

# macOS: .dmg for Intel + Apple Silicon
npm run dist -w desktop -- --mac

# macOS: just the .app for this Mac (fast, no .dmg), then install it
npm run dist -w desktop -- --mac dir --arm64      # use --x64 on Intel Macs
ditto desktop/release/mac-arm64/Readloft.app /Applications/Readloft.app

# Linux: AppImage + .deb
npm run dist -w desktop -- --linux

# Windows: NSIS installer .exe
npm run dist -w desktop -- --win

# everything at once
npm run dist -w desktop -- --mac --linux --win
```

Linux and Windows builds are most reliable on their own OS. Cross-building Windows from macOS may need Wine. For all three platforms, pushing a version tag (above) builds them on GitHub Actions.

Quit any running Readloft (including `npm run desktop:dev`) before opening a freshly installed build. The app is single-instance, so a running copy takes over.

## Roadmap ideas

- Users & auth, per-user progress
- Annotations/highlights and bookmarks
- Online metadata lookup (Open Library / Google Books)
- OPDS feed for other reading apps
- Reading stats and goals
- PWA / offline reading
- PDF tools: merge, split, convert
- Self-hostable out of the box, plus installable desktop apps: buildable for macOS, Windows and Linux

## Contributing

Issues and pull requests are welcome at <https://github.com/dfoltynski/readloft>. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Readloft is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is free for personal and noncommercial use, including modification and forks. Commercial use requires a commercial license; see [COMMERCIAL.md](COMMERCIAL.md). Contributions are welcome under the terms in [CONTRIBUTING.md](CONTRIBUTING.md).

The vendored [foliate-js](https://github.com/johnfactotum/foliate-js) remains MIT-licensed by John Factotum.
