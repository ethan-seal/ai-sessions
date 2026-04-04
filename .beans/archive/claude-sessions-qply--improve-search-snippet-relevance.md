---
# claude-sessions-qply
title: Improve search snippet relevance
status: completed
type: task
priority: normal
created_at: 2026-04-04T14:47:24Z
updated_at: 2026-04-04T15:07:06Z
---

**Background**: When `ai-sessions search` finds a match, the preview snippet often shows text from the first occurrence or session start rather than the actual matching content. This makes it hard to judge whether a session is relevant without running `show` on it — which loads unnecessary context.

**Symptom**: Searched for "jai" and the matching session showed a generic tool result preview instead of the actual match (a nixpkgs PR discussion about jai-jail). The session was dismissed as irrelevant based on the misleading snippet.

**Goal**: Search result previews should show a snippet centered around the matched term with surrounding context, similar to how `grep -C` works.

**Constraints**: Keep output concise — don't increase total output volume, just make the existing preview more relevant.

**Checklist**:
- [ ] Identify where search preview snippets are generated in the search command
- [ ] Change snippet extraction to center on the match position rather than using the start of the message
- [ ] Include ~100 chars of context on each side of the match
- [ ] Truncate/ellipsis long previews as before
- [ ] Test with a search term that appears mid-conversation but not at the start
