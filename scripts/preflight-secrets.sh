#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HAS_RG=0
if command -v rg >/dev/null 2>&1; then
  HAS_RG=1
fi

files="$(git ls-files)"
if [ -z "$files" ]; then
  if [ "$HAS_RG" -eq 1 ]; then
    files="$(rg --files -g '!node_modules/**' -g '!.git/**')"
  else
    files="$(find . -type f ! -path './.git/*' ! -path './node_modules/*' -print | sed 's#^\./##')"
  fi
fi
if [ -z "$files" ]; then
  echo "[preflight] no files to scan"
  exit 0
fi

pattern='(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|postgres(ql)?://[^[:space:]]+:[^[:space:]]+@)'

ignore_globs=(
  '--glob=!**/.env.example'
  '--glob=!**/*.md'
)

echo "[preflight] scanning tracked files for common secret patterns..."
if [ "$HAS_RG" -eq 1 ]; then
  if rg -n -I -S -e "$pattern" "${ignore_globs[@]}" $files; then
    echo "[preflight] possible secret found. aborting." >&2
    exit 1
  fi
else
  found=0
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    case "$file" in
      *.md|*/.env.example|.env.example)
        continue
        ;;
    esac
    if grep -n -I -E "$pattern" "$file"; then
      found=1
    fi
  done <<< "$files"
  if [ "$found" -eq 1 ]; then
    echo "[preflight] possible secret found. aborting." >&2
    exit 1
  fi
fi

echo "[preflight] secret scan passed"
