# Governance

Libristead is a small project. This document states how it is run and, more importantly, what will not change.

## Decision making

- The project is maintainer-led. The maintainer is GitHub user `dfoltynski`.
- Decisions are made in public: issues and pull requests, with reasoning written down.
- The goal is to have a second maintainer. A single point of failure is a project risk.

### Becoming a maintainer

Contributors who have landed several non-trivial, well-tested changes over a few months, review others' work constructively, and follow the [Code of Conduct](CODE_OF_CONDUCT.md) may be invited, or may ask in an issue. Maintainers get merge rights and take part in decisions. Decisions between maintainers are made by consensus; if there is none, the license commitments below still bind everyone.

## Pull request handling

- First response to a pull request within 7 days. If that is not possible, a comment will say so.
- Rejections are explained with concrete reasons.
- A rejected idea will not be re-implemented without crediting the original author. If work from a declined or closed PR is used, the author is credited with a `Co-authored-by:` trailer and/or in the changelog.
- Contributors keep authorship of their commits.
- Large or AI-generated changes are subject to [AI_POLICY.md](AI_POLICY.md).

## License commitment

- Libristead stays licensed under `AGPL-3.0-only`.
- No move to BSL, SSPL, FSL or any other source-available or non-open-source license.
- No paid edition that takes features away from the free one. Anything shipped in the free version stays free.
- No Contributor License Agreement and no copyright assignment. Contributions use the DCO sign-off (see [CONTRIBUTING.md](CONTRIBUTING.md)), so contributors keep their copyright and the code cannot be relicensed without their consent.

## Conduct

The [Code of Conduct](CODE_OF_CONDUCT.md) is enforced against behavior, never against criticism of the project, its direction or its maintainers. Critics are not banned for being critics.

## Continuity

If the maintainer steps away:

1. Hand over to a willing co-maintainer where one exists.
2. Otherwise, archive the repository (read-only) after at least 90 days of public notice in the README and a pinned issue, so the community can fork or take over.
3. The repository, its history, releases and issues are never deleted.

## Changes to this document

Changes go through a pull request and stay open for comment for at least 14 days. The license commitment above may only be changed in the direction of more openness.
