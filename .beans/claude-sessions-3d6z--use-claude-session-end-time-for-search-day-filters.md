---
# claude-sessions-3d6z
title: Use Claude session end time for search day filters
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:23Z
updated_at: 2026-05-07T20:13:46Z
---

**Symptom**: `ai-sessions search --days <n>` can omit Claude sessions that started before the cutoff but were active recently.
**Root cause**: The Claude path in `cmdSearch` tracks only the minimum timestamp as `startTime` and sets `endTime: ""` at `src/index.ts:725`, while the later filter at `src/index.ts:803` uses `endTime || startTime`.
**Reproduction**: Create or find a Claude JSONL session whose first timestamp is older than the cutoff and whose last timestamp is newer; run `ai-sessions search <term> --days <n>`.
**Expected**: Day filters should use the latest activity timestamp for Claude sessions, matching list behavior and OpenCode sessions.

**Checklist**:
- [ ] Track max timestamp as `endTime` in the Claude search session construction path.
- [ ] Apply the cutoff using latest activity.
- [ ] Add a regression test or fixture for a long-running Claude session crossing the cutoff.
- [ ] Verify `ai-sessions search <term> --days <n>` still works for OpenCode and Claude.
