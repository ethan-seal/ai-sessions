---
# claude-sessions-entx
title: Fix double-reading of files in cmdSearch
status: completed
type: bug
priority: high
created_at: 2026-03-23T21:10:12Z
updated_at: 2026-03-23T21:16:30Z
---

cmdSearch calls getClaudeSessions() which parses every JSONL file, then re-reads those same files. Restructure to avoid the redundant I/O.
