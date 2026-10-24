---
# claude-sessions-sacj
title: Hide skill trigger-eval sessions from list and search
status: completed
type: feature
priority: normal
created_at: 2026-10-23T17:54:16Z
updated_at: 2026-10-24T20:39:09Z
---

**Background.** Skill trigger evals start one `claude -p` session per query per run. A single nixos eval on 2026-10-22 added 264 sessions to `list`/`search`. Both eval runners register the skill under test as a temporary command named `<skill>-skill-<8 hex>`: skill-creator's `run_eval.py` and `~/.claude/skill-eval/src/run-eval.ts:96`. Claude Code records that name in the transcript's `skill_listing` attachment (`attachment.names`). The Claude parser is `src/sources/claude/index.ts` (`JsonlRecord` :53, `parseClaudeRecords` :195, summary literal ending :248).

**Decision: hide skill-eval sessions from `list` and `search` by default. A new `--include-evals` flag shows them.** A session is a skill eval when **both** of these hold:
- a user record has `entrypoint === "sdk-cli"` (started with `claude -p`)
- any `skill_listing` attachment has a name matching `/-skill-[0-9a-f]{8}$/`

Other `claude -p` sessions stay visible. `show` and `resume` by ID still find eval sessions.

## The edit

1. `src/domain/session.ts`: add `readonly skillEval: boolean;` to `SessionSummary`.
2. `src/sources/claude/index.ts`:
   ```ts
   +const SKILL_EVAL_COMMAND = /-skill-[0-9a-f]{8}$/;

    interface JsonlRecord {
   -  type: "user" | "assistant";
   +  type: "user" | "assistant" | "attachment";
      isMeta?: boolean;
      sessionId?: string;
      cwd?: string;
   +  entrypoint?: string;
   +  attachment?: { type?: string; names?: string[] };
      timestamp?: string;

   // parseClaudeRecords: alongside sessionId/cwd capture
   +  let headless = false;
   +  let hasEvalCommand = false;
   ...
   +    if (record.type === "user" && record.entrypoint === "sdk-cli") {
   +      headless = true;
   +    }
   +    if (
   +      record.attachment?.type === "skill_listing" &&
   +      record.attachment.names?.some((name) => SKILL_EVAL_COMMAND.test(name))
   +    ) {
   +      hasEvalCommand = true;
   +    }

   // returned summary
   +    skillEval: headless && hasEvalCommand,
   ```
   Widening `type` may make tsc flag `record.type` checks that assumed only two values. Fix them so they keep treating attachment records as neither user nor assistant.
3. Codex and OpenCode sources: set `skillEval: false` in every `SessionSummary` literal. `bun run typecheck` lists each one.
4. `src/commands/list.ts` / `src/commands/search.ts`: add `includeEvals?: boolean` to `ListOpts`/`SearchOpts`. Unless it is set, drop sessions with `skillEval` (in search, `match.session.skillEval`) before the other filters.
5. `src/cli/args.ts`: parse `--include-evals` in `parseListArgs` and `parseSearchArgs`. Add `[--include-evals]` to the search usage error.
6. `src/cli/help.ts`: add a line under both `list` and `search`: `--include-evals     Include skill trigger-eval runs`.
7. Tests:
   - `src/cli/args.test.ts`: check that `--include-evals` is parsed for list and search.
   - Claude parser test with jsonl fixtures, covering all four combinations:
     - `sdk-cli` + eval name → `skillEval: true`
     - `sdk-cli` without an eval name → `false`
     - `cli` + eval name → `false` (this is the parent session that ran the eval)
     - a name like `nixos` or `my-skill-helper` → `false`

## Checklist

- [ ] `bun run check` passes (typecheck + biome + tests).
- [ ] Negative check: temporarily drop the `headless &&` condition. The `cli` + eval-name test fails. Then revert.
- [ ] From `~`, `bun src/index.ts list scratchpad/sc | grep -c '\[claude\]'` → `0`. With `--include-evals` → `132`.
- [ ] `bun src/index.ts list quickfix-review-nvim` still lists `2f96ff77` (the interactive session that ran the eval).
- [ ] `bun src/index.ts list /tmp` still lists the non-eval `-p` sessions ("Fix the auth bug", "Second message").
- [ ] `bun src/index.ts show eaf7071d` still prints that eval transcript.
- [ ] Default `bun src/index.ts list | grep -c '\[claude\]'` is exactly 264 lower than the count with `--include-evals`. If newer eval runs exist, it is lower by 264 plus their count.
- [ ] (you) Push to GitHub, then `nix flake update ai-sessions --flake ~/.config/nixos && nh os switch ~/.config/nixos`. Installed `ai-sessions list scratchpad/sc` prints `No sessions found.`

## Baseline

Measured 2026-10-23 with installed ai-sessions 2.0.0:
- `ai-sessions list | grep -c '\[claude\]'` → **4355**
- `ai-sessions list scratchpad/sc | grep -c '\[claude\]'` → **132**

Per-transcript scan of `~/.claude/projects`:

| | `-skill-<8hex>` in skill_listing | not |
|---|---|---|
| `sdk-cli` | 264 | 10 |
| `cli` | 1 (`2f96ff77`, parent session) | rest |

Expected: exactly the 264 top-left sessions disappear from the default output.

## Do not

- Don't use the eval-name marker without the `sdk-cli` check. That would hide `2f96ff77`, an interactive session that picked up the temporary commands mid-session.
- Don't check only the first `skill_listing` record. In `2f96ff77` the eval names arrive in a later delta listing.
- Don't read `entrypoint` from the first record of the file. The first lines of eval transcripts are `queue-operation` records with no `entrypoint`.
- Don't filter inside `getClaudeJsonlPaths` or return `null` from `parseClaudeRecords`. That would also break `show`/`resume` for eval sessions.
- Don't match on eval prompt text or on `/tmp`/`scratchpad` paths. One eval run used cwd `~`, so its sessions sit among real ones in `-home-ethans`.

---

## Evidence

- `run_eval.py`: `clean_name = f"{skill_name}-skill-{unique_id}"` with `unique_id = uuid.uuid4().hex[:8]`. `run-eval.ts:95-96`: `` `${skillName}-skill-${randomUUID().slice(0, 8)}` ``.
- Example eval session `eaf7071d-119a-440e-aefe-c3d0dac3ee10`: line 3 is a user record with `entrypoint: "sdk-cli"`. Its `skill_listing` attachment (`keys: content,isInitial,names,skillCount,type`) lists ten `nixos-skill-<hex>` names, from parallel workers.
- The 10 `sdk-cli` sessions without the marker are `/tmp` test prompts, short `-p` questions from `acli`, and one tool-listing probe.
