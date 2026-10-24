---
# claude-sessions-r6gu
title: Add OpenAI Codex session support
status: completed
type: feature
priority: normal
created_at: 2026-05-07T17:52:36Z
updated_at: 2026-05-07T20:13:46Z
---

**Background**: `ai-sessions` currently supports Claude Code JSONL under `~/.claude/projects/` and OpenCode SQLite at `~/.local/share/opencode/opencode.db`. OpenAI Codex CLI stores local session transcripts as rollout JSONL files and also maintains a SQLite thread index.

**Research notes**:
- Local install is `codex-cli 0.128.0`.
- Codex transcript files are at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; this machine has 34 rollout files.
- Each rollout starts with a `session_meta` record whose payload includes `id`, `cwd`, `timestamp`, `originator`, `cli_version`, `source`, `model_provider`, and optional `git` metadata.
- `~/.codex/state_5.sqlite` has a `threads` table with `id`, `rollout_path`, `created_at_ms`, `updated_at_ms`, `source`, `model_provider`, `cwd`, `title`, `archived`, `first_user_message`, `model`, `reasoning_effort`, and other metadata. Prefer this for listing when present.
- Codex `history.jsonl` contains prompt history rows shaped like `{ session_id, ts, text }`, useful as fallback only.
- Rollout event types observed locally include `event_msg user_message`, `event_msg agent_message`, `response_item message`, `response_item function_call`, `response_item function_call_output`, `response_item reasoning`, and web search events.
- `codex resume --help` accepts `codex resume [SESSION_ID] [PROMPT]`, supports `--last`, `--all`, and `--include-non-interactive`.
- Public/primary sources also describe Codex as a local CLI and reference rollout JSONL under `~/.codex/sessions/**/rollout-*.jsonl` with `session_meta.cwd` as the project/session anchor.

**Goal**: Make `ai-sessions` list, search, show, resume, backup, and restore OpenAI Codex sessions alongside Claude and OpenCode.

**Current code areas**:
- `src/index.ts:11` Source union is currently `"claude" | "opencode"`.
- `src/index.ts:90` helper constants define Claude/OpenCode paths only.
- `src/index.ts:581` `getAllSessions()` combines only Claude and OpenCode.
- `src/index.ts:687` `cmdSearch()` has separate Claude/OpenCode search paths.
- `src/index.ts:825` `cmdShow()` dispatches only Claude/OpenCode renderers.
- `src/index.ts:958` `cmdResume()` only launches Claude/OpenCode.
- `src/index.ts:1006` backup includes only Claude projects and OpenCode DB.
- README and `claude-skill/SKILL.md` describe only Claude Code and OpenCode.

**Implementation sketch**:
- Add `codex` to `Source` and display tag `[codex]`.
- Add `CODEX_HOME = process.env.CODEX_HOME || ~/.codex`, `CODEX_SESSIONS_DIR`, and `CODEX_STATE_DB`.
- Implement `getCodexSessions()` using `state_5.sqlite` `threads` rows where available, excluding archived rows by default and mapping `rollout_path` to `filePath`. Fall back to scanning `sessions/**/rollout-*.jsonl` and reading `session_meta` plus first real user message.
- Parse rollout JSONL records for searchable text from user/assistant messages and tool calls/results. Avoid surfacing developer/system/base instructions as user-facing content.
- Implement `showCodexSession()` with readable User/Assistant/Tool sections. Keep reasoning/internal/developer/system records hidden by default.
- Update search to include Codex rollout text and preserve `\b` boundary behavior.
- Update resume to invoke `codex resume <session.id>` using argv-based process execution, not a shell command string.
- Update backup/restore to include `~/.codex/sessions`, `~/.codex/history.jsonl`, and `~/.codex/state_5.sqlite` when present. Consider whether WAL/SHM files should be included or whether SQLite backup/copy should be handled specially.
- Update README/help/skill docs and examples to mention Codex.

**Constraints**:
- Preserve existing Claude and OpenCode behavior.
- Do not expose internal/developer/system prompt text in normal `show` output.
- Handle missing Codex DB or missing rollout paths gracefully.
- Avoid shell interpolation for resume.
- Keep the source parser tolerant of Codex schema changes.

**Checklist**:
- [ ] Add Codex source types, constants, and session discovery.
- [ ] Add Codex rollout parsing for list/search/show.
- [ ] Add Codex resume command path.
- [ ] Extend backup/restore for Codex session data.
- [ ] Update CLI help, README, and Claude skill docs.
- [ ] Add fixtures or tests for Codex `session_meta`, user/assistant messages, function calls, and function outputs.
- [ ] Verify with local commands: `ai-sessions list --cwd`, `ai-sessions search codex --cwd`, `ai-sessions show <codex-id> --short`, and dry-run restore listing.
