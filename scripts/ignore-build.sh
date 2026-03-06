#!/bin/bash
# ============================================================
# Vercel Ignored Build Step
# ============================================================
# This script is called by Vercel before every build.
#   Exit 0 = skip the build (no changes that matter)
#   Exit 1 = proceed with the build
#
# Docs: https://vercel.com/docs/concepts/projects/overview#ignored-build-step
# ============================================================

echo "🔍 Running build relevance check..."

# --- 1. Always build on production branch -----------------
if [[ "$VERCEL_GIT_COMMIT_REF" == "main" || "$VERCEL_GIT_COMMIT_REF" == "production" ]]; then
  echo "✅ Production branch ($VERCEL_GIT_COMMIT_REF) — proceeding with build."
  exit 1
fi

# --- 2. Skip draft / WIP branches ------------------------
BRANCH="$VERCEL_GIT_COMMIT_REF"
if [[ "$BRANCH" == wip/* || "$BRANCH" == draft/* || "$BRANCH" == test/* || "$BRANCH" == experiment/* ]]; then
  echo "⏭️  Skipping build — branch '$BRANCH' is WIP/draft/test."
  exit 0
fi

# --- 3. Check changed files against ignore patterns ------
# Compare against the previous successful deployment commit.
# Vercel provides VERCEL_GIT_PREVIOUS_SHA on redeploys.
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"
CHANGED_FILES=$(git diff --name-only "$BASE_SHA" HEAD 2>/dev/null || echo "UNKNOWN")

if [[ "$CHANGED_FILES" == "UNKNOWN" ]]; then
  echo "⚠️  Could not determine changed files — proceeding with build."
  exit 1
fi

echo "📝 Changed files since last deploy:"
echo "$CHANGED_FILES"

# Patterns of files that do NOT require a rebuild
IGNORE_PATTERNS=(
  '\.md$'
  '\.txt$'
  '\.log$'
  '^README'
  '^LICENSE'
  '^CHANGELOG'
  '^docs/'
  '^\.github/'
  '^\.vscode/'
  '^\.idea/'
  '^desktop-app/'
  '^scripts/seed'
  '^scripts/setup'
  '^scripts/register'
  '^scripts/reactivate'
  '^scripts/create-initial'
  # Mobile app (talioapp) — completely separate project
  '^\.\.\/talioapp/'
  '^talioapp/'
  # Git / CI meta files
  '\.gitignore$'
  '\.gitattributes$'
  '\.editorconfig$'
  '\.prettierrc'
  '\.prettierignore$'
  '\.eslintignore$'
  '\.nvmrc$'
  '\.npmrc$'
  # Test files
  '\.test\.'
  '\.spec\.'
  '__tests__/'
  '__mocks__/'
  # Images & static assets that Next.js doesn't process at build time
  '\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|mp3|wav|ogg)$'
)

# Build a single extended-regex pattern
COMBINED_PATTERN=$(IFS='|'; echo "${IGNORE_PATTERNS[*]}")

# Check if ALL changed files match ignore patterns
RELEVANT_FILES=$(echo "$CHANGED_FILES" | grep -vE "$COMBINED_PATTERN" || true)

if [[ -z "$RELEVANT_FILES" ]]; then
  echo "⏭️  All changed files are non-build-relevant — skipping build."
  echo "   Matched ignore patterns: docs, markdown, mobile app, CI config, etc."
  exit 0
fi

echo ""
echo "🔨 Build-relevant files detected:"
echo "$RELEVANT_FILES"
echo ""
echo "✅ Proceeding with build."
exit 1
