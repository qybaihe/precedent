#!/bin/bash
# Playwright 1.49 downloads its video encoder from a retired CDN (the download hangs or arrives truncated).
# Put a shim at the path Playwright expects that runs Homebrew ffmpeg (needs libvpx) with higher-quality
# VP8 settings than Playwright's default 1 Mbit/s, which blurs UI text.
set -euo pipefail
DIR="$HOME/Library/Caches/ms-playwright/ffmpeg-1010"
mkdir -p "$DIR"
cat > "$DIR/ffmpeg-mac" <<'SHIM'
#!/bin/bash
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -b:v) args+=(-b:v 14M); shift 2 ;;
    -qmax) args+=(-qmax 10); shift 2 ;;
    -crf) args+=(-crf 4); shift 2 ;;
    -threads) args+=(-threads 6); shift 2 ;;
    -speed) args+=(-speed 5); shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
exec /opt/homebrew/bin/ffmpeg "${args[@]}"
SHIM
chmod +x "$DIR/ffmpeg-mac"
echo "installed $DIR/ffmpeg-mac -> $(/opt/homebrew/bin/ffmpeg -version | head -1)"
