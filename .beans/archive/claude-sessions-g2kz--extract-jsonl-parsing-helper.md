---
# claude-sessions-g2kz
title: Extract JSONL parsing helper
status: completed
type: task
priority: normal
created_at: 2026-03-23T21:10:07Z
updated_at: 2026-03-23T21:13:35Z
---

The read-file/split-lines/filter-blanks/JSON.parse pattern repeats in parseClaudeSession, cmdSearch, and showClaudeSession. Extract a parseJsonlRecords(filePath) helper.
