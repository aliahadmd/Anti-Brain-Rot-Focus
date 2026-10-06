#!/bin/sh
# Builds a store-ready zip containing only the files the extension needs.
set -eu

cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="dist/anti-brain-rot-focus-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -qr "$out" manifest.json background.js lib icons \
  popup.html popup.js popup.css \
  blocked.html blocked.js blocked.css \
  options.html options.js options.css
echo "Wrote $out"
