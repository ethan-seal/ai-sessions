# ai-sessions

A command-line tool for browsing, searching, and managing your [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://github.com/opencode-ai/opencode), and OpenAI Codex session history.

## Features

- **Browse sessions** grouped by project directory
- **Full-text search** across all messages (user, assistant, and tool interactions)
- **View complete conversations** with formatted output and pager support
- **Resume sessions** directly from the CLI
- **Backup and restore** session data with automated retention policies
- **Unified interface** for Claude Code, OpenCode, and Codex sessions
- **Claude Code skill** for searching sessions within Claude conversations

## Claude Code Skill

A Claude Code skill is included for searching sessions directly within Claude conversations.

### Quick Install

```bash
./claude-skill/install.sh
```

### Usage in Claude

Once installed, Claude will automatically search your session history when you ask:

```
"How did we implement authentication before?"
"What sessions did we have about Docker?"
"Find where we discussed database migrations"
```

Claude can search across all past sessions, show full conversations, and even resume previous work.

See [claude-skill/README.md](claude-skill/README.md) for complete skill documentation.

## Installation

### Using Nix Flakes

Add to your `flake.nix` inputs:

```nix
{
  inputs.ai-sessions.url = "github:yourusername/ai-sessions";  # Update with your repo
}
```

Then add to your system packages or home-manager configuration:

```nix
environment.systemPackages = [
  inputs.ai-sessions.packages.${system}.default
];
```

### Manual Installation with Bun

```bash
git clone <repository-url>
cd ai-sessions
bun install
bun link
```

Or run directly:

```bash
bun src/index.ts <command>
```

## Usage

### List Sessions

```bash
# List all sessions grouped by project
ai-sessions
ai-sessions list

# Filter sessions by project path
ai-sessions list dotfiles
```

Output example:
```
~/Programming/my-project (3 sessions, last active: 2024-01-15)
  2024-01-15 15:30  a1b2c3d4  [claude] "Add user authentication"
  2024-01-14 09:20  e5f6g7h8  [opencode] "Fix database migration"
  2024-01-13 14:45  i9j0k1l2  [codex] "Refactor API endpoints"
```

### Search Sessions

Full-text search across all message content, including:
- User messages
- Assistant responses
- Tool use parameters (file paths, commands, code)
- Tool results

```bash
ai-sessions search "authentication"
ai-sessions search "import React"
ai-sessions search "git commit"
```

Search results show:
- Session metadata (date, ID, project)
- Role where match was found (user/assistant/tool)
- Preview of matching text

### View Session Details

```bash
# Show full conversation with pager (less)
ai-sessions show a1b2c3d4

# Show truncated overview
ai-sessions show a1b2c3d4 --short
```

The viewer displays:
- Session metadata (ID, source, project, timestamps)
- Formatted conversation with message headers
- Tool use details with truncated parameters
- Automatic paging for long conversations

### Resume a Session

```bash
# Resume in original working directory
ai-sessions resume a1b2c3d4
```

Automatically detects whether to launch `claude --resume`, `opencode --session`, or `codex resume`.

### Backup & Restore

Create timestamped tar.gz backups of all session data:

```bash
# Create backup with default settings
ai-sessions backup

# Specify destination and retention
ai-sessions backup --dest ~/Dropbox/backups --keep 30
```

Backup includes:
- `~/.claude/projects/` (Claude Code JSONL files)
- `~/.local/share/opencode/opencode.db` (OpenCode SQLite database)
- `~/.codex/sessions/` (Codex rollout JSONL files)
- `~/.codex/history.jsonl` and `~/.codex/state_5.sqlite` (Codex prompt history and thread index)

List available backups:

```bash
ai-sessions restore
```

Preview what would be restored:

```bash
ai-sessions restore ai-sessions-backup-2024-01-15T14-30-00.tar.gz
```

Restore from backup:

```bash
ai-sessions restore ai-sessions-backup-2024-01-15T14-30-00.tar.gz --force
```

## Automated Backups

### Using Home Manager (NixOS)

Enable automated backups in your home-manager configuration:

```nix
{
  imports = [ inputs.ai-sessions.homeManagerModules.default ];

  services.ai-sessions-backup = {
    enable = true;
    frequency = "daily";  # systemd calendar expression
    keep = 10;            # number of backups to retain
    destination = "~/.ai-sessions-backups";
  };
}
```

### Manual systemd Setup

Copy the service and timer files:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/ai-sessions-backup.service ~/.config/systemd/user/
cp systemd/ai-sessions-backup.timer ~/.config/systemd/user/

# Edit the service file to set correct paths
nano ~/.config/systemd/user/ai-sessions-backup.service

# Enable and start the timer
systemctl --user enable --now ai-sessions-backup.timer

# Check status
systemctl --user status ai-sessions-backup.timer
```

## How It Works

### Data Sources

**Claude Code** stores sessions as JSONL (JSON Lines) files in `~/.claude/projects/`:
- Each project gets a directory named after its path
- Sessions are individual `.jsonl` files with timestamped records
- Records contain messages, metadata, and tool interactions

**OpenCode** uses a SQLite database at `~/.local/share/opencode/opencode.db`:
- Sessions table with metadata and titles
- Messages and parts tables for conversation content

**Codex** stores rollout transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and keeps a thread index at `~/.codex/state_5.sqlite`:
- The SQLite index is used for fast session listing when present
- Rollout JSONL files are used for full search and transcript display
- Internal metadata, developer/system instructions, and reasoning records are hidden from normal `show` output

### Project Path Detection

For Claude sessions, the project directory is determined by:
1. The `cwd` field in session metadata (most reliable)
2. Parsing the project directory name (fallback)

The directory name parser handles:
- Leading dashes for root paths (`-home-user-project` → `/home/user/project`)
- Double dashes for dotfiles (`--config-nvim` → `/.config/nvim`)
- Multi-segment paths with filesystem validation

### Search Implementation

Search performs case-insensitive substring matching across:
- **Text blocks** in user and assistant messages
- **Tool use inputs** (JSON-stringified for deep search)
- **Tool results** (both string and structured content)

For Claude and Codex sessions, the tool parses JSONL in a single pass for performance. For OpenCode sessions, it uses SQL queries with the SQLite FTS (full-text search) pattern.

## Command Reference

```
ai-sessions [command]

Searches and browses sessions from Claude Code, OpenCode, and OpenAI Codex.

Commands:
  (none)              List all sessions grouped by project
  list [filter]       List sessions, optionally filtered by project name
    --cwd               Only show sessions for the current directory
    --days <n>          Only show sessions active in the last n days
    --limit <n>         Max sessions to show per directory
  search <term>       Full-text search across all session messages
    --cwd               Only search sessions for the current directory
    --days <n>          Only search sessions active in the last n days
  show <session-id>   Show full conversation for a session
    --short             Truncated overview (200 chars per message)
  resume <session-id> Resume a session in its original directory

Backup & Restore:
  backup              Create a tar.gz backup of all session data
    --dest <dir>        Backup destination (default: ~/.ai-sessions-backups/)
    --keep <n>          Retention: keep last n backups (default: 10)
  restore             List available backups
    --dest <dir>        Backup directory to list from
  restore <archive>   Show what a backup would restore
    --force             Actually restore (overwrite existing files)
    --dest <dir>        Backup directory to search for archive

Sources:
  Claude Code:  ~/.claude/projects/  (JSONL files)
  OpenCode:     ~/.local/share/opencode/opencode.db  (SQLite)
  Codex:        ~/.codex/sessions/ and ~/.codex/state_5.sqlite
```

## Configuration

The tool uses these default paths:
- **Claude projects**: `~/.claude/projects/`
- **OpenCode database**: `~/.local/share/opencode/opencode.db`
- **Codex home**: `$CODEX_HOME` or `~/.codex/`
- **Backup directory**: `~/.ai-sessions-backups/`
- **Pager**: `$PAGER` environment variable (defaults to `less -R`)

## Requirements

- [Bun](https://bun.sh/) runtime
- `tar` command for backups/restore
- Optional: `claude`, `opencode`, or `codex` CLI for resume functionality

## Development

```bash
# Run directly
bun src/index.ts list

# Type check
bun run typecheck

# Build distribution
bun run build
```

## License

MIT

## Related Projects

- [Claude Code](https://github.com/anthropics/claude-code) - Official Anthropic CLI
- [OpenCode](https://github.com/opencode-ai/opencode) - Open source AI coding assistant
