---
# claude-sessions-lfsd
title: Sort list groups by latest activity instead of start time
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:30Z
updated_at: 2026-05-07T20:13:46Z
---

**Symptom**: `ai-sessions list` can show incorrect "last active" dates and ordering for long-lived sessions.
**Root cause**: `groupByProject` sorts sessions by `startTime` and sets `lastActive` from `projectSessions[0].startTime` at `src/index.ts:612` and `src/index.ts:618`, despite sessions having `endTime`.
**Reproduction**: Have a session with an old start timestamp and a newer end timestamp than another session; run `ai-sessions list` and compare ordering/last active output.
**Expected**: Session ordering and project `lastActive` should use `endTime || startTime`.

**Checklist**:
- [ ] Introduce a helper for latest activity timestamp, e.g. `session.endTime || session.startTime`.
- [ ] Sort sessions within a project by latest activity.
- [ ] Set group `lastActive` from latest activity, not start time.
- [ ] Add a regression test or fixture for sessions whose start and end ordering differ.
