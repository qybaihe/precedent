#!/usr/bin/env bash
# Deploy Precedent.
#   scripts/deploy.sh dev    -> development, with the token-protected selftest web trigger injected
#   scripts/deploy.sh prod   -> production, exactly manifest.yml (no web triggers, keeps Runs on Atlassian)
set -euo pipefail
cd "$(dirname "$0")/../app"
source ~/hackathons/.secrets/atlassian.env
ENV=${1:-dev}
if [ "$ENV" = "dev" ]; then
  cp manifest.yml /tmp/precedent-manifest.backup.yml
  trap 'cp /tmp/precedent-manifest.backup.yml manifest.yml' EXIT
  python3 - <<'PY'
s = open('manifest.yml').read()
s = s.replace("  consumer:\n", "  webtrigger:\n    - key: selftest-webtrigger\n      function: selftest\n      response:\n        type: dynamic\n  consumer:\n", 1)
s = s.replace("  function:\n", "  function:\n    - key: selftest\n      handler: index.selftest\n", 1)
open('manifest.yml', 'w').write(s)
PY
  forge deploy --non-interactive -e development ${2:-}
else
  forge deploy --non-interactive -e production ${2:-}
fi
