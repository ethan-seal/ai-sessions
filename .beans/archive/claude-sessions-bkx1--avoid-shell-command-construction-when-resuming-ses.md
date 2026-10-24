---
# claude-sessions-bkx1
title: Avoid shell command construction when resuming sessions
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:16Z
updated_at: 2026-05-07T20:13:46Z
---

**Symptom**: `ai-sessions resume <id>` builds a shell command string and passes it to `execSync`.
**Root cause**: `src/index.ts:968` interpolates `session.id` into a command string. Session IDs are read from local JSONL/SQLite state, so malformed or imported session data can become shell input.
**Reproduction**: Inspect `cmdResume` in `src/index.ts`; the command is built as a string for both Claude and OpenCode.
**Expected**: Resume should invoke CLIs with argv arrays, not shell strings.

**Checklist**:
- [ ] Replace `execSync(cmd, ...)` with `spawnSync` or equivalent argv-based execution.
- [ ] Use `claude` args `["--dangerously-skip-permissions", "--resume", session.id]` and `opencode` args `["--session", session.id]`.
- [ ] Preserve cwd handling and inherited stdio.
- [ ] Add or document a regression case for IDs containing shell metacharacters.
