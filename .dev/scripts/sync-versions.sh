#!/usr/bin/env bash
# sync-versions.sh — propagate version from package.json to plugin metadata files
# Called automatically by `pnpm version` after `changeset version`
#
# The marketplace lists more than one plugin. Only the `plot` entry follows
# package.json; every other entry (the `plot-follow` mod under `mods/`) keeps
# the version its own `.claude-plugin/plugin.json` declares, because at install
# time plugin.json wins and `claude plugin validate --strict` refuses an entry
# that disagrees with it. test/reconcile/sync-versions.test.mjs holds that pair.
#
# The `plot` entry installs from this repository at `ref` `v<version>`, the tag
# create-release.sh pushes after the release PR merges, so the sync writes the
# ref beside the version. A `plot` entry whose source is not an object fails
# the jq filter and so the release.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION=$(jq -r '.version' "$REPO_ROOT/package.json")

echo "Syncing version $VERSION to plugin metadata files..."

sync_file() {
  local file="$1"
  local filter="$2"
  local tmp="${file}.tmp"
  jq --arg v "$VERSION" "$filter" "$file" > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$file"
  echo "  ✓ $file"
}

sync_file "$REPO_ROOT/.claude-plugin/plugin.json"      '.version = $v'
sync_file "$REPO_ROOT/.claude-plugin/marketplace.json" '.plugins |= map(if .name == "plot" then (.version = $v | .source.ref = "v\($v)") else . end)'

echo "Done. Plugin metadata files now at version $VERSION"

# Strip self-attribution from CHANGELOG ("Thanks @owner!" is noise when you're the sole author)
changelog="$REPO_ROOT/CHANGELOG.md"
if [ -f "$changelog" ]; then
  owner=$(jq -r '.changelog[1].repo // ""' "$REPO_ROOT/.changeset/config.json" | cut -d/ -f1)
  if [ -n "$owner" ]; then
    sed "s/ Thanks \[@${owner}\](https:\/\/github\.com\/${owner})!//g" "$changelog" > "${changelog}.tmp" && mv "${changelog}.tmp" "$changelog"
    echo "  ✓ Stripped self-attribution from CHANGELOG.md"
  fi
fi
