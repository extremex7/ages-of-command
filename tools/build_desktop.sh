#!/usr/bin/env bash
# Builds the desktop packages into build/desktop/:
#   AgesOfCommand-<v>-windows-setup.exe     per-user installer (no admin rights needed)
#   AgesOfCommand-<v>-windows-portable.zip  unzip and run; saves stay in its userdata folder
#   AgesOfCommand-<v>-linux-x64.tar.gz
#   AgesOfCommand-<v>-macos.tar.gz          Apple silicon and Intel launchers, start.command picks
# Needs Go 1.22+, zip and (for the installer) NSIS's makensis. go-winres, when installed
# (go install github.com/tc-hib/go-winres@v0.3.3), gives the Windows launcher its icon.
# Usage: tools/build_desktop.sh [version]   (default: package.json's version)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
V=${1:-$(node -p "require('./package.json').version")}
OUT=$ROOT/build/desktop
STAGE=$OUT/stage
export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin
rm -rf "$OUT"; mkdir -p "$STAGE"

# the game itself: what index.html loads, plus the docs (without screenshots) for modders
game() {
  local d=$1/game
  mkdir -p "$d/docs"
  cp index.html "$d/"
  cp -r src styles data "$d/"
  cp docs/*.md README.md "$d/docs/"
  find "$d" -name '__pycache__' -prune -exec rm -rf {} +
}

LDFLAGS="-s -w -X main.version=$V"
build() { # goos goarch output [extra ldflags]
  (cd launcher && CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "$LDFLAGS ${4:-}" -o "$3" .)
}

# --- Windows
W=$STAGE/windows; mkdir -p "$W"
if command -v go-winres >/dev/null; then
  (cd launcher && go-winres simply --arch amd64 --icon icon/icon.ico --manifest gui \
    --product-name "Ages of Command" --file-description "Ages of Command" \
    --product-version "$V.0" --file-version "$V.0" --original-filename AgesOfCommand.exe)
else
  echo "go-winres not found: the Windows launcher will have no icon"
fi
build windows amd64 "$W/AgesOfCommand.exe" "-H windowsgui"
rm -f launcher/rsrc_windows_*.syso
game "$W"
sed 's/$/\r/' launcher/README.txt > "$W/README.txt"
if command -v makensis >/dev/null; then
  (cd launcher && makensis -V2 -DVERSION="$V" -DSTAGE="$W" -DOUTFILE="$OUT/AgesOfCommand-$V-windows-setup.exe" installer.nsi)
else
  echo "makensis not found: skipping the Windows installer"
fi
P=$STAGE/portable/AgesOfCommand; mkdir -p "$P/userdata"
cp -r "$W/." "$P/"
(cd "$STAGE/portable" && zip -qr9 "$OUT/AgesOfCommand-$V-windows-portable.zip" AgesOfCommand)

# --- Linux
L=$STAGE/linux/AgesOfCommand; mkdir -p "$L"
build linux amd64 "$L/AgesOfCommand"
game "$L"; cp launcher/README.txt "$L/"
tar -C "$STAGE/linux" -czf "$OUT/AgesOfCommand-$V-linux-x64.tar.gz" AgesOfCommand

# --- macOS (unsigned: the first time, right-click start.command and choose Open)
M=$STAGE/macos/AgesOfCommand; mkdir -p "$M"
build darwin arm64 "$M/AgesOfCommand-arm64"
build darwin amd64 "$M/AgesOfCommand-x64"
cat > "$M/start.command" <<'SH'
#!/bin/sh
cd "$(dirname "$0")"
if [ "$(uname -m)" = "arm64" ]; then exec ./AgesOfCommand-arm64 "$@"; else exec ./AgesOfCommand-x64 "$@"; fi
SH
chmod +x "$M/start.command"
game "$M"; cp launcher/README.txt "$M/"
tar -C "$STAGE/macos" -czf "$OUT/AgesOfCommand-$V-macos.tar.gz" AgesOfCommand

rm -rf "$STAGE"
ls -la "$OUT"
