# Contributing to Libristead

Thanks for helping! Start with `CLAUDE.md` / `README.md` for layout and commands.

## License of contributions

Libristead is licensed under the GNU Affero General Public License v3.0 only
(`AGPL-3.0-only`). Contributions are accepted under the same license. There is
no CLA and no copyright assignment.

Every commit must carry a [Developer Certificate of Origin](https://developercertificate.org/)
sign-off, which confirms you wrote the change or have the right to submit it
under the project license.

Add `Signed-off-by: Your Name <email>` to your commits (`git commit -s`) to confirm.

## Sign-off (DCO)

Sign every commit:

```sh
git commit -s -m "Fix cover cache"
```

Forgot? Fix the last commit with `git commit --amend -s --no-edit`. To add sign-off to every commit in your branch:

```sh
git rebase --signoff origin/main
git push --force-with-lease
```

The sign-off email must match the commit author email. A CI check enforces this on pull requests.

## Development

```sh
npm install
npm run setup      # vendor foliate-js (once, and after pulling)
npm run dev        # server + web in watch mode
npm test           # server tests
npm run typecheck
npm run build      # build the web UI
```

Run tests, typecheck and build before opening a PR.

## Pull requests

- Keep PRs small: about 800 changed lines at most, excluding generated files and lockfiles. Split larger work or discuss it in an issue first.
- Behavior changes need tests.
- AI tools are fine; disclose substantial AI generation and make sure you understand the code. See [AI_POLICY.md](AI_POLICY.md).
- You can expect a first response within 7 days. See [GOVERNANCE.md](GOVERNANCE.md).

## Project documents

- [GOVERNANCE.md](GOVERNANCE.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) (report vulnerabilities privately, not in issues)
- [AI_POLICY.md](AI_POLICY.md)
