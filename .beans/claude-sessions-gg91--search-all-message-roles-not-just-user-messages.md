---
# claude-sessions-gg91
title: Search all message roles, not just user messages
status: in-progress
type: feature
priority: normal
created_at: 2026-03-22T17:39:48Z
updated_at: 2026-03-22T17:44:33Z
---

Currently, the search command only checks user messages. It should also search assistant messages and tool_use content (code written, file edits, bash commands). This is the biggest gap — you can't find 'that session where Claude wrote the auth middleware' because assistant output is never searched.
