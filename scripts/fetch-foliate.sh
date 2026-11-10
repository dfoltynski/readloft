#!/bin/sh
# Vendors foliate-js (MIT, https://github.com/johnfactotum/foliate-js) into web/public.
# foliate-js is not published to npm; it is served as raw ES modules.
set -e
DEST="web/public/foliate-js"
REF="${FOLIATE_REF:-main}"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --depth 1 origin "$REF" && git -C "$DEST" checkout -q FETCH_HEAD
else
  rm -rf "$DEST"
  git clone --depth 1 --branch "$REF" https://github.com/johnfactotum/foliate-js "$DEST"
fi
echo "foliate-js ready at $DEST ($(git -C "$DEST" rev-parse --short HEAD))"
