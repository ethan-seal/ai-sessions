---
# claude-sessions-vqu6
title: Extract duplicated session lookup helper
status: completed
type: task
priority: normal
created_at: 2026-03-23T21:10:16Z
updated_at: 2026-03-23T21:17:16Z
---

The pattern sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId)) is duplicated in cmdShow (line 661) and cmdResume (line 817). Extract a findSession helper.
