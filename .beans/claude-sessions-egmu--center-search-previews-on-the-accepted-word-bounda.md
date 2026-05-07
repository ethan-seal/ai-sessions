---
# claude-sessions-egmu
title: Center search previews on the accepted word-boundary match
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:36Z
updated_at: 2026-05-07T20:29:07Z
---

**Symptom**: Search preview snippets can highlight context around an earlier rejected substring instead of the actual match for `\b` searches.
**Root cause**: `matchesTerm` honors word-boundary constraints, but `snippetAround` at `src/index.ts:215` uses the first raw `indexOf(pt.lower)` occurrence and does not reuse the accepted match location.
**Reproduction**: Search for `\bjai\b` in a record containing `jail ... jai`; the session can match because `jai` exists, but the preview may center around `jail`.
**Expected**: Preview snippets should be centered on the same occurrence that satisfied the term matcher.

**Checklist**:
- [x] Refactor matching to return the accepted match index, or add a helper that finds the boundary-valid index.
- [x] Use that index in `snippetAround`.
- [x] Preserve simple substring behavior for non-boundary searches.
- [x] Add a regression case for `jail ... jai` with `\bjai\b`.
