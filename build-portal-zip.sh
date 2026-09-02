#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

ZIP_NAME="autorick-portal-build.zip"

echo "==> Packaging clean HTML5 portal build: $ZIP_NAME..."
rm -f "$ZIP_NAME"

zip -r "$ZIP_NAME" \
  index.html \
  game.js \
  audio.js \
  portal-bridge.js \
  style.css \
  assets/ \
  README.md \
  -x "*.DS_Store"

echo "==> Done! Build created at: $DIR/$ZIP_NAME"
ls -lh "$ZIP_NAME"
