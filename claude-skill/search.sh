#!/usr/bin/env bash
# Helper script for ai-sessions skill
# Provides structured output for Claude to parse

set -euo pipefail

command="${1:-}"
shift || true

case "$command" in
  search)
    # Run search and capture output
    ai-sessions search "$@"
    ;;

  list)
    # Run list and capture output
    ai-sessions list "$@"
    ;;

  show)
    # Show session with --short flag for better integration
    session_id="$1"
    shift || true

    if [[ "$*" == *"--full"* ]]; then
      ai-sessions show "$session_id"
    else
      ai-sessions show "$session_id" --short
    fi
    ;;

  resume)
    # Resume session
    ai-sessions resume "$@"
    ;;

  *)
    echo "Usage: $0 {search|list|show|resume} [args...]"
    echo ""
    echo "Examples:"
    echo "  $0 search authentication"
    echo "  $0 list dotfiles"
    echo "  $0 show a1b2c3d4"
    echo "  $0 show a1b2c3d4 --full"
    echo "  $0 resume a1b2c3d4"
    exit 1
    ;;
esac
