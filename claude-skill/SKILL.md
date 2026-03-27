---
name: ai-sessions
description: >
  Use when the user asks to search past sessions, find previous conversations,
  look up how something was done before, or reference earlier AI interactions.
  Searches across Claude Code and OpenCode session history with full-text search.
---

# AI Sessions Search

Search and browse your Claude Code and OpenCode session history.

## When to Use This Skill

Use this skill when the user:
- Asks about previous conversations or sessions
- Wants to find how something was implemented before
- Needs to reference past work or decisions
- Asks "how did we do X before?" or "what did we discuss about Y?"
- Wants to see sessions for a specific project
- Needs to resume a previous session

## Available Commands

### Search Past Sessions

Search across all message content (user, assistant, and tool interactions):

```bash
ai-sessions search <term> [--cwd] [--days <n>]
```

**Examples:**
```bash
# Find sessions about authentication
ai-sessions search authentication

# Find sessions with specific code
ai-sessions search "import React"

# Restrict to current directory
ai-sessions search "git rebase" --cwd

# Only sessions from the last 7 days
ai-sessions search "config.yaml" --days 7

# Combine filters
ai-sessions search "docker" --cwd --days 14
```

Search results show:
- Session date and ID
- Project directory
- Role where match was found (user/assistant/tool)
- Preview of matching text

### List Sessions by Project

```bash
# List all sessions
ai-sessions list

# Filter by project path (substring match)
ai-sessions list dotfiles
ai-sessions list claude-sessions
ai-sessions list ~/Programming

# Only sessions for the current directory (exact match)
ai-sessions list --cwd

# Only sessions active in the last N days
ai-sessions list --days 5

# Limit entries shown per directory
ai-sessions list --limit 3

# Combine flags
ai-sessions list --cwd --days 7
ai-sessions list --days 14 --limit 5
```

Output groups sessions by project and shows:
- Number of sessions per project
- Last active date
- Session details with timestamps and first message

### View Full Conversation

```bash
# Show complete session with pager
ai-sessions show <session-id>

# Show truncated overview (200 chars per message)
ai-sessions show <session-id> --short
```

Use the short session ID (first 8 characters) shown in list/search results.

**Example:**
```bash
# From search/list: "a1b2c3d4"
ai-sessions show a1b2c3d4
```

The viewer displays:
- Session metadata
- Full conversation with formatted messages
- Tool use details
- Automatic paging for long sessions

### Resume a Session

```bash
ai-sessions resume <session-id>
```

Automatically:
- Changes to the original working directory
- Launches `claude --resume` or `opencode --session` as appropriate
- Continues the conversation where it left off

## Common Workflows

### "How did we implement X before?"

1. **Search for the topic:**
   ```bash
   ai-sessions search "authentication"
   ```

2. **View the relevant session:**
   ```bash
   ai-sessions show a1b2c3d4
   ```

3. **If needed, resume to continue:**
   ```bash
   ai-sessions resume a1b2c3d4
   ```

### "What have we worked on in this project?"

1. **List sessions for current project:**
   ```bash
   # Exact match on current directory
   ai-sessions list --cwd

   # Or use a name/path segment as a substring filter
   ai-sessions list $(basename $(pwd))
   ```

2. **Or search for project-specific terms:**
   ```bash
   ai-sessions search "dockerfile" --cwd  # in current directory only
   ```

### "What have I been working on recently?"

```bash
# All sessions from the last 5 days
ai-sessions list --days 5

# Recent sessions in this directory, newest 3 per project
ai-sessions list --cwd --days 7 --limit 3
```

### "Find where we used a specific tool/command"

Search includes tool use parameters, so you can find sessions where specific commands were run:

```bash
# Find sessions where git commands were used
ai-sessions search "git commit"

# Find sessions that edited specific files
ai-sessions search "package.json"

# Find sessions using specific tools
ai-sessions search "Edit tool"
```

## Understanding Search Results

Search performs case-insensitive matching across:
- **User messages** - What you asked
- **Assistant responses** - What Claude/OpenCode wrote
- **Tool use inputs** - File paths, commands, code in tool parameters
- **Tool results** - Output from tools

Match role indicators:
- `[user]` - Found in your message
- `[assistant]` - Found in AI response text
- `[tool]` - Found in tool use parameters or results

## Tips

- **Use specific terms**: Search for function names, file names, error messages
- **Search for code**: Finds exact code snippets in tool parameters
- **Partial IDs work**: Use just the first 8 characters of session IDs
- **View before resuming**: Use `show` to check if it's the right session
- **Short view for quick checks**: Add `--short` to quickly scan a session

## Integration with Current Session

When helping users find information from past sessions:

1. **Ask clarifying questions** if the search term is too broad
2. **Run the search** using the Bash tool
3. **Parse and summarize** the results for the user
4. **Offer to show details** if they want to see a specific session
5. **Suggest resuming** if they want to continue that work

**Example interaction:**
```
User: "How did we set up authentication before?"

You: Let me search past sessions for authentication work...
     [Run: ai-sessions search authentication]

You: I found 3 sessions about authentication:
     1. Session a1b2c3d4 from 2024-01-15 in ~/project-x
        - Implemented JWT authentication with refresh tokens
     2. Session e5f6g7h8 from 2024-01-10 in ~/api-server
        - Added OAuth2 integration
     3. Session i9j0k1l2 from 2024-01-05 in ~/docs
        - Discussed authentication strategies

     Would you like me to show the full conversation from any of these?
```

## Data Sources

- **Claude Code**: `~/.claude/projects/` (JSONL files)
- **OpenCode**: `~/.local/share/opencode/opencode.db` (SQLite)

## Limitations

- Only searches non-archived sessions
- Requires `ai-sessions` to be installed and in PATH
- Session must have been created by Claude Code or OpenCode
- Cannot search sessions that have been manually deleted