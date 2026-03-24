# AI Sessions - Claude Code Skill

This skill enables Claude Code to search and reference your past AI coding sessions.

## Installation

### Quick Install

From the ai-sessions project directory:

```bash
./claude-skill/install.sh
```

### Manual Install

```bash
cp -r claude-skill ~/.claude/skills/ai-sessions
```

## What This Enables

Once installed, Claude can automatically search your session history when you ask questions like:

- "How did we implement authentication before?"
- "What sessions did we have about Docker?"
- "Find where we discussed database migrations"
- "Show me the conversation where we set up the API"

## How It Works

The skill gives Claude access to the `ai-sessions` CLI, allowing it to:

1. **Search** across all past sessions (user messages, assistant responses, and tool interactions)
2. **List** sessions by project or topic
3. **Show** full conversation transcripts
4. **Resume** past sessions to continue work

## Examples

### Search Past Work

```
You: "How did we set up the database connection pool?"

Claude: Let me search past sessions...
        [Runs: ai-sessions search "database connection pool"]

        Found 2 sessions:
        1. Session a1b2c3d4 (2024-01-15) - Implemented connection pooling
        2. Session e5f6g7h8 (2024-01-10) - Discussed pool configuration

        Would you like me to show the details from session a1b2c3d4?
```

### Find Project-Specific Sessions

```
You: "What have we worked on in this project?"

Claude: Let me check the session history for this directory...
        [Runs: ai-sessions list dotfiles]

        Found 5 sessions in ~/dotfiles:
        - Initial setup and configuration
        - Added zsh customizations
        - Set up vim plugins
        - Created backup scripts
        - Added Nix home-manager config
```

### Reference Tool Usage

The skill searches tool interactions, so Claude can find sessions where specific commands or files were used:

```
You: "Where did we use git rebase before?"

Claude: [Runs: ai-sessions search "git rebase"]

        Found in 3 sessions where git rebase was used...
```

## Requirements

- `ai-sessions` must be installed and available in PATH
- Claude Code or OpenCode sessions must exist in:
  - `~/.claude/projects/` (Claude Code)
  - `~/.local/share/opencode/opencode.db` (OpenCode)

## Skill Files

- `SKILL.md` - Skill definition and documentation for Claude
- `search.sh` - Helper script for cleaner output
- `install.sh` - Installation script

## Uninstall

```bash
rm -rf ~/.claude/skills/ai-sessions
```

The skill will be removed from the next Claude Code session.
