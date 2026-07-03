#!/usr/bin/env bash
# create-release.sh — post-merge: create git tags and GitHub Release
# Called by: changesets/action publish step (after version PR merges)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

source "$(dirname "$0")/lib.sh"

VERSION=$(jq -r '.version' "$REPO_ROOT/package.json")
echo "Creating release for v${VERSION}..."

# Create overall version tag
if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
  echo "  Tag v${VERSION} already exists — skipping"
else
  git tag "v${VERSION}"
  echo "  ✓ Tagged v${VERSION}"
fi

# Create per-skill tags for skills whose version tag doesn't exist yet
for skill_dir in "$REPO_ROOT"/skills/*/; do
  [ ! -d "$skill_dir" ] && continue
  skill="$(basename "$skill_dir")"
  skill_md="$skill_dir/SKILL.md"
  [ ! -f "$skill_md" ] && continue

  skill_version=$(extract_version "$skill_md")
  [ -z "$skill_version" ] && continue

  tag_name="${skill}@${skill_version}"
  if git rev-parse "$tag_name" >/dev/null 2>&1; then
    continue  # tag already exists
  fi

  git tag "$tag_name"
  echo "  ✓ Tagged $tag_name"
done

# Push all tags
git push --tags
echo "  ✓ Pushed tags"

# Extract changelog section for this version
changelog_file="$REPO_ROOT/CHANGELOG.md"
if [ -f "$changelog_file" ]; then
  # Extract content between "## X.Y.Z" and the next "## " header (or EOF)
  release_notes=$(awk -v ver="$VERSION" '
    $0 ~ "^## " ver { found=1; next }
    found && /^## / { exit }
    found { print }
  ' "$changelog_file")
else
  release_notes="Release v${VERSION}"
fi

# Create GitHub Release
# Idempotent: skip if the release already exists — the publish step re-runs on
# every changeset-free push to main.
if command -v gh >/dev/null 2>&1; then
  if gh release view "v${VERSION}" >/dev/null 2>&1; then
    echo "  Release v${VERSION} already exists — skipping"
  else
    tmp_notes=$(mktemp)
    echo "$release_notes" > "$tmp_notes"
    gh release create "v${VERSION}" \
      --title "v${VERSION}" \
      --notes-file "$tmp_notes" \
      --latest
    rm -f "$tmp_notes"
    echo "  ✓ Created GitHub Release v${VERSION}"
  fi
else
  echo "  WARN: gh CLI not available — skipping GitHub Release creation"
  echo "  Run manually: gh release create v${VERSION} --title 'v${VERSION}' --notes-file CHANGELOG.md"
fi

echo "Done."
