# shrink_history.ps1 — drop the map tiles out of git history, once.
#
# WHY. web/static/*.pmtiles were committed three times in one day. Each is a
# fresh 40-50 MB binary and git keeps every version forever, so .git reached
# 130 MB for a repo whose source is under 2 MB. Removing the file from the tip
# does nothing; the blobs live in history. This rewrites every commit so they
# were never there.
#
# THE TILES DO GET REMOVED FROM web\static\. filter-branch checks out the
# rewritten HEAD when it finishes, and the rewritten HEAD does not contain
# them, so git deletes them like any other file that left the tree. They are
# not lost: web\build\ still holds the copies Vite made, and the script copies
# them back at the end. If you ever run a rewrite by hand, restore them
# yourself or rebuild per docs/TILES.md.
#
# THIS REWRITES HISTORY. Every commit gets a new hash, so the push afterwards
# must be forced. That is safe here because you are the only person with a
# clone. If anyone else ever clones this repo, do not run it again without
# telling them.
#
# Run from the repo root:   powershell -ExecutionPolicy Bypass -File scripts\shrink_history.ps1

$ErrorActionPreference = 'Stop'

# Stale lock files. The Cowork session that prepared this cannot delete inside
# .git, so a lock it created may still be sitting there and every git command
# will refuse to run until it is gone. Safe to remove: no git process is
# running from that session.
foreach ($lock in '.git\HEAD.lock', '.git\index.lock') {
  if (Test-Path $lock) { Remove-Item -Force $lock; Write-Host "removed stale $lock" }
}
Get-ChildItem .git\objects -Recurse -Filter 'tmp_obj_*' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# Anything prepared but not yet committed (docs/TILES.md, this script).
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "Tiles out of git: ignore rule, TILES.md, and a one-shot history rewrite

web/static/*.pmtiles are build artifacts. Three rebuilds in one day put
three 40-50 MB blobs in history permanently and took .git to 130 MB for
a repo whose source is under 2 MB.

- .gitignore stops tracking them; they stay on disk and the site is
  unaffected. Missing archives already fall back to the SVG renderer.
- docs/TILES.md: what the two archives are, how to rebuild each, why the
  tiler is hand-written, and why the labels are English.
- scripts/shrink_history.ps1 removes the existing blobs from history."
  Write-Host "committed the prepared changes"
}

Write-Host "Before:" -ForegroundColor Cyan
git count-objects -vH | Select-String 'size-pack'

# A branch pointing at the current history, in case you want it back.
git branch -f backup-before-rewrite

# Rewrite every commit and tag, removing the tiles from the index only.
$env:FILTER_BRANCH_SQUELCH_WARNING = 1
git filter-branch --force --index-filter `
  "git rm --cached --ignore-unmatch web/static/dhaka.pmtiles web/static/dhaka_admin.pmtiles" `
  --prune-empty --tag-name-filter cat -- --all

# Drop every reference to the old history, then actually collect the garbage.
# Without these two steps the blobs are still in .git and nothing shrinks.
git for-each-ref --format='%(refname)' refs/original | ForEach-Object { git update-ref -d $_ }
Remove-Item -Recurse -Force .git\refs\original -ErrorAction SilentlyContinue
git reflog expire --expire=now --all
git gc --prune=now --aggressive

Write-Host "After:" -ForegroundColor Cyan
git count-objects -vH | Select-String 'size-pack'

# Put the tiles back. filter-branch checked out a HEAD that does not have them,
# which deletes them from the working tree; web\build\ is gitignored so its
# copies survived untouched.
foreach ($t in 'dhaka.pmtiles', 'dhaka_admin.pmtiles') {
  if (-not (Test-Path "web\static\$t") -and (Test-Path "web\build\$t")) {
    Copy-Item "web\build\$t" "web\static\$t"
    Write-Host "restored web\static\$t from web\build\"
  }
}

Write-Host ""
Write-Host "Tiles on disk:" -ForegroundColor Cyan
Get-ChildItem web\static\*.pmtiles -ErrorAction SilentlyContinue |
  Select-Object Name, Length
if (-not (Test-Path 'web\static\dhaka.pmtiles')) {
  Write-Host "MISSING. Rebuild or copy them: see docs/TILES.md" -ForegroundColor Red
}

Write-Host ""
Write-Host "Now force-push (history changed, so this is required):" -ForegroundColor Yellow
Write-Host "  git push --force origin main"
Write-Host "  git push --force origin v1.0"
Write-Host ""
Write-Host "If anything looks wrong, the old history is on branch backup-before-rewrite."
