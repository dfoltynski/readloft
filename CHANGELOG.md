# Changelog

## 0.3.0 (unreleased)

### Upgrade notes
- **Server/Docker:** after upgrading, the server asks for first-run setup. Get the one-time setup code from the logs (`docker logs libristead`), open the web UI, enter the code and choose a password.
- **Desktop app:** needs no login.
- Existing data (database, browser settings, desktop app data) migrates automatically.
- A `.readloft` sync folder keeps working.

### Added
- Authentication: password login with first-run setup code, reverse-proxy auth (`AUTH=proxy`), and API tokens (Bearer or Basic) for e-reader clients.
- OPDS 1.2 catalog at `/opds`.
- Public health endpoint `GET /api/health` (returns `{ok, version}`) and a Docker `HEALTHCHECK`.
- Multi-arch (amd64, arm64) Docker image published to ghcr.io on release tags; copy-paste `docker-compose.yml`.
- Automated tests and CI.
- DCO sign-off for contributions, plus governance docs (GOVERNANCE, AI policy, SECURITY, code of conduct, third-party notices).
- About dialog.
- foliate-js is pinned to a fixed commit.

### Changed
- Renamed from Readloft to Libristead; existing data (database, browser settings, desktop app data) is migrated automatically, and an existing .readloft sync folder keeps working.
- License changed from PolyForm Noncommercial 1.0.0 to GNU AGPL-3.0-only. Versions up to and including 0.2.0 remain available under PolyForm Noncommercial 1.0.0.
- Removed `COMMERCIAL.md`; no commercial licenses are offered.
- Contributions now use a Developer Certificate of Origin sign-off instead of a relicensing grant.

### Security
- The server now requires login by default (`AUTH=password`). `AUTH=none` is only allowed on a loopback `HOST`.
- The desktop app binds to 127.0.0.1.
