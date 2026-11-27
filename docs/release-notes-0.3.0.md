# Libristead 0.3.0

First release as **Libristead** (formerly Readloft), now licensed under **AGPL-3.0-only**, with login, OPDS and a ready-to-use Docker image.

## Highlights
- Login by default: password with a first-run setup code, reverse-proxy auth, and API tokens.
- OPDS 1.2 catalog for KOReader, Thorium, Moon+ Reader and friends.
- Multi-arch Docker image (`linux/amd64`, `linux/arm64`) on ghcr.io with a health check and a copy-paste `docker-compose.yml`.
- Tests, CI, DCO sign-off, governance docs, About dialog, pinned foliate-js.
- Security: the server requires login by default; the desktop app binds to 127.0.0.1.
- License changed from PolyForm Noncommercial to AGPL-3.0-only. Libristead stays AGPL-3.0: no relicensing to source-available licenses, no paid edition.

## Upgrade notes
- **Server / Docker:** after upgrading the server asks for first-run setup. Get the setup code with `docker logs libristead`, open the web UI and choose a password.
- **Desktop app:** no login needed.
- Existing data migrates automatically; a `.readloft` sync folder keeps working.

## Quick start
```sh
curl -O https://raw.githubusercontent.com/dfoltynski/libristead/main/docker-compose.yml
docker compose up -d
docker logs libristead
```

## Links
- [README](https://github.com/dfoltynski/libristead#readme)
- [Changelog](https://github.com/dfoltynski/libristead/blob/main/CHANGELOG.md)
- [Security policy](https://github.com/dfoltynski/libristead/blob/main/SECURITY.md)

Note: there is no public demo instance. Consider adding a short GIF of the reader and library to this release page.
