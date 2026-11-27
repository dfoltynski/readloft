#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Vendors foliate-js (MIT, https://github.com/johnfactotum/foliate-js) into web/public.
# foliate-js is not published to npm; it is served as raw ES modules.
# The commit is pinned in scripts/foliate.lock (the only place to change it).
set -e
cd "$(dirname "$0")/.."
DEST="web/public/foliate-js"
REPO="https://github.com/johnfactotum/foliate-js"
SHA="$(tr -d ' \n' < scripts/foliate.lock)"
case "$SHA" in
  *[!0-9a-f]*|"") echo "scripts/foliate.lock must hold a full commit SHA" >&2; exit 1 ;;
esac
[ "${#SHA}" -eq 40 ] || { echo "scripts/foliate.lock must hold a 40-char SHA" >&2; exit 1; }

if [ ! -d "$DEST/.git" ]; then
  rm -rf "$DEST"
  git init -q "$DEST"
  git -C "$DEST" remote add origin "$REPO"
fi
if [ "$(git -C "$DEST" rev-parse HEAD 2>/dev/null)" != "$SHA" ]; then
  git -C "$DEST" fetch -q --depth 1 origin "$SHA"
  git -C "$DEST" checkout -q --detach FETCH_HEAD
fi

GOT="$(git -C "$DEST" rev-parse HEAD)"
if [ "$GOT" != "$SHA" ]; then
  echo "foliate-js SHA mismatch: expected $SHA, got $GOT" >&2
  exit 1
fi
echo "foliate-js ready at $DEST ($GOT)"
