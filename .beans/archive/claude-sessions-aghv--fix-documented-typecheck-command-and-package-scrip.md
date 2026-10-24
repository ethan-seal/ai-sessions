---
# claude-sessions-aghv
title: Fix documented typecheck command and package scripts
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:54Z
updated_at: 2026-05-07T20:13:46Z
---

**Symptom**: The README documents `bun run tsc --noEmit`, but that command fails with `error: Script not found "tsc"`.
**Root cause**: `package.json` has only a `start` script and does not include `typescript` or a `typecheck`/`tsc` script, while `tsconfig.json` exists and `bunx tsc --noEmit` succeeds.
**Reproduction**: Run `bun run tsc --noEmit` from the repo root.
**Expected**: The documented typecheck command should work, or the documentation should point to the supported command.

**Checklist**:
- [ ] Add an explicit typecheck script, e.g. `"typecheck": "tsc --noEmit"`, or update docs to use `bunx tsc --noEmit`.
- [ ] Add `typescript` as a dev dependency if using a local script.
- [ ] Update README development instructions accordingly.
- [ ] Verify the documented command succeeds from a clean install.
