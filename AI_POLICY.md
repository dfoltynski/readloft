> **Draft — pending maintainer approval**

# AI policy

## How the project uses AI

The maintainer uses AI coding assistants. Every change, AI-assisted or not, is read and understood by a human before it is merged. The human author is responsible for the change, its correctness, and its license compliance.

## For contributors

You may use AI tools to write code, tests, or docs. In return:

- **Disclose** substantial AI generation in the pull request description (the PR template has a checkbox). Autocomplete and minor edits do not need disclosure.
- **Understand your code.** You must be able to explain and defend every line in review. Pull requests that the author cannot explain may be closed.
- **You are the author.** You sign off the DCO (see [CONTRIBUTING.md](CONTRIBUTING.md)), certifying you have the right to submit the change.
- **Keep it small.** A PR should stay under about 800 changed lines, excluding generated files and lockfiles, unless agreed beforehand in an issue. Split larger work into reviewable steps.
- **Test it.** Behavior changes need tests. Untested AI output is not accepted.
- No AI attribution trailers (such as `Co-authored-by:` naming a tool) are required, and none are added by maintainers.

Large unreviewed AI-generated PRs will be closed with an explanation, and a request to split them.
