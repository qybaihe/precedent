#!/usr/bin/env bash
# Opens a plain (non-automated) Chromium on the shared profile so a human can sign in with Google.
# Google blocks sign-in from automation-controlled browsers, so this does NOT go through Playwright,
# but it uses the same mock keychain / password store so Playwright can reuse the session later.
# A local DevTools port lets tools/wait-login.mjs see when the session is ready.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE="$HERE/../.browser-profile"
CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonCookie" "$PROFILE/SingletonSocket"
exec "$CHROMIUM" --user-data-dir="$PROFILE" --use-mock-keychain --password-store=basic \
  --no-first-run --no-default-browser-check --remote-debugging-port=9333 --window-size=1440,900 \
  "https://id.atlassian.com/login?continue=https%3A%2F%2F${ATLASSIAN_SITE:-qybaihe-forge.atlassian.net}%2Fjira"
