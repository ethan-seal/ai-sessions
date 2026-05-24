export const BIN_NAME = "ai-sessions";

export function helpText(): string {
  return `Usage: ${BIN_NAME} [command]

Searches and browses sessions from Claude Code, OpenCode, and OpenAI Codex.

Commands:
  (none)              List all sessions grouped by project
  list [filter]       List sessions, optionally filtered by project name
    --cwd               Only show sessions for the current directory
    --days <n>          Only show sessions active in the last n days
    --limit <n>         Max sessions to show per directory
  search <term>       Full-text search across all session messages
    --cwd               Only search sessions for the current directory
    --days <n>          Only search sessions active in the last n days
  show <session-id>   Show full conversation for a session
    --short             Truncated overview (200 chars per message)
  resume <session-id> Resume a session in its original directory

Sources:
  Claude Code:  ~/.claude/projects/  (JSONL files)
  OpenCode:     ~/.local/share/opencode/opencode.db  (SQLite)
  Codex:        ~/.codex/sessions/ and ~/.codex/state_5.sqlite`;
}
