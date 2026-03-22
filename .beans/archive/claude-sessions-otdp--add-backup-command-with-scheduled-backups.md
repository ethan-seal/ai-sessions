---
# claude-sessions-otdp
title: Add backup command with scheduled backups
status: completed
type: feature
priority: normal
created_at: 2026-03-22T17:39:53Z
updated_at: 2026-03-22T17:44:26Z
---

Session data in ~/.claude/projects/ (JSONL) and ~/.local/share/opencode/opencode.db (SQLite) are the only copies of session history. Add a 'backup' subcommand that:
1. Creates a timestamped tar.gz archive of both data sources
2. Supports a configurable backup destination directory
3. Supports a retention policy (e.g. keep last N backups)
4. Provides a way to schedule regular backups (systemd timer, cron, or similar)
5. Includes a 'restore' subcommand to recover from a backup
