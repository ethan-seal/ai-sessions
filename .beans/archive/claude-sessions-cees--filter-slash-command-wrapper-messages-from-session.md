---
# claude-sessions-cees
title: Filter slash-command wrapper messages from session listings
status: completed
type: bug
priority: normal
created_at: 2026-05-07T17:47:43Z
updated_at: 2026-05-07T20:13:46Z
---

**Symptom**: `ai-sessions list` and `ai-sessions show --short` can display slash-command wrapper XML like `<command-message>...</command-message>` as the first user message.
**Root cause**: `isMetaOrCommand` at `src/index.ts:427` filters `<command-name>` and some command stdout/caveat text, but not `<command-message>`.
**Reproduction**: Run `bun src/index.ts list --cwd --limit 3` in this repo; session `915ef1e3...` shows `<command-message>beansnext</command-message>...`. `bun src/index.ts show 915ef1e3 --short` also surfaces it.
**Expected**: Command wrapper messages should be treated as metadata/command noise and omitted from first-message selection and display.

**Checklist**:
- [ ] Update `isMetaOrCommand` to recognize `<command-message>` wrappers.
- [ ] Verify first-message extraction skips those records and falls through to the first real user message when present.
- [ ] Add a regression fixture or test covering command wrapper records.
- [ ] Verify list/search/show behavior remains unchanged for normal user messages.
