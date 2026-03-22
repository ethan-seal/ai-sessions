---
# claude-sessions-p4r5
title: Show full conversation with streaming output
status: completed
type: feature
priority: normal
created_at: 2026-03-22T17:39:50Z
updated_at: 2026-03-22T17:51:18Z
---

The show command currently truncates all messages to 200 characters, making it impossible to read full conversations. Replace truncation with streaming/paged output that displays the complete conversation. Consider piping through a pager (like less) or printing incrementally so large sessions don't overwhelm the terminal.
