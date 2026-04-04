---
# claude-sessions-fplb
title: Remove dead hasToolContent logic in extractSearchableText
status: completed
type: bug
priority: high
created_at: 2026-03-23T21:10:02Z
updated_at: 2026-03-23T21:11:51Z
---

Line 262: the ternary always evaluates to role. The hasToolContent computation on lines 253-258 is dead code. Remove it or make it functional.
