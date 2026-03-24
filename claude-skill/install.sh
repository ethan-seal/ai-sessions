#!/usr/bin/env bash
# Install ai-sessions skill for Claude Code

set -euo pipefail

SKILL_DIR="$HOME/.claude/skills/ai-sessions"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing ai-sessions skill for Claude Code..."

# Create skills directory if it doesn't exist
mkdir -p "$HOME/.claude/skills"

# Check if skill already exists
if [ -e "$SKILL_DIR" ]; then
  echo "Skill already exists at $SKILL_DIR"
  read -p "Remove existing and reinstall? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$SKILL_DIR"
  else
    echo "Installation cancelled."
    exit 0
  fi
fi

# Copy skill files
cp -r "$SCRIPT_DIR" "$SKILL_DIR"

echo "✓ Skill installed to $SKILL_DIR"
echo ""
echo "The skill will be available in your next Claude Code session."
echo "Try asking: 'Search past sessions for authentication'"
