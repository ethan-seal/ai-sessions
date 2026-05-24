# Target Architecture: ai-sessions

This document describes the architecture ai-sessions should move toward, independent of the current generated architecture map. It is the comparison target for refactoring: implementation work should periodically check whether the code is becoming more like this design.

## Purpose

ai-sessions should expose one local CLI for finding, inspecting, and resuming AI coding sessions across supported assistant tools. The architecture should make source-specific storage formats replaceable behind stable source adapters, while keeping CLI commands source-neutral.

The core architectural rule is:

```text
source-specific adapters -> canonical domain model -> source-neutral commands
```

Adding another assistant source should require adding one backend and registering it, not changing the internals of `list`, `search`, `show`, or `resume`.

## Target Subsystems

```text
CLI layer
  parses arguments, validates command options, calls commands, reports fatal errors

Command layer
  implements list/search/show/resume as source-neutral user workflows

Application services
  orchestrate discovery, search fan-out, transcript loading, project grouping, ID resolution, and resume validation

Source backend interface
  defines the contract every assistant source implements

Source backends
  isolate Claude Code, OpenCode, and Codex storage, parsing, searching, transcript loading, and resume mechanics

Canonical domain model
  defines shared SessionSummary, Transcript, SearchResult, ProjectGroup, and ResumeTarget contracts

Output layer
  renders human-readable text, transcript views, JSON output, and pager integration

Shared infrastructure
  provides filesystem, path, JSONL, SQLite, process, and error helpers
```

## Target Dependency Direction

```text
cli -> commands -> services -> sources
                 -> domain
                 -> output
sources -> domain
output  -> domain
shared  -> no app-specific dependency
```

Rules:

- CLI and commands must not parse vendor files or query vendor databases directly.
- Source backends must not render terminal output.
- Source backends may depend on shared infrastructure and domain contracts.
- Services own cross-source behavior such as fan-out, sorting, partial failure handling, and ID resolution.
- Output owns human formatting and JSON serialization.

## Canonical Data Contracts

### Source

```text
Source = claude | opencode | codex
```

### SessionSummary

A normalized session record used by list, search, show, and resume.

```text
SessionSummary
├── id                source session identifier
├── source            assistant source
├── projectDir        display/grouping project directory
├── cwd               original working directory when known
├── title             source title when available
├── firstMessage      fallback display label
├── startedAt         session start time when known
├── lastActiveAt      latest activity time when known
└── backingRef        opaque source-specific reference
```

### Transcript

```text
Transcript
├── session           SessionSummary
└── entries           TranscriptEntry[]
```

### TranscriptEntry

```text
TranscriptEntry
├── timestamp
├── role              user | assistant | tool_call | tool_result | system | unknown
├── text
├── toolName?
├── command?
├── fileRefs?
└── rawSourceRef?
```

The `show` command should render this contract instead of branching on source-specific transcript shapes.

### SearchResult

```text
SearchResult
├── session           SessionSummary
├── matchRole         user | assistant | tool | metadata | unknown
├── preview           text centered around the match
├── matchedText
└── rank/sort metadata
```

### ProjectGroup

```text
ProjectGroup
├── projectDir
├── sessions          SessionSummary[]
└── lastActiveAt
```

### ResumeTarget

```text
ResumeTarget
├── source
├── executable
├── args
├── cwd
└── unavailableReason?
```

The resume command executes a `ResumeTarget`; source backends decide what target is appropriate.

## Source Backend Interface

Each assistant backend should implement one source-neutral interface:

```ts
interface SessionSource {
  readonly source: Source;

  discoverSessions(): Promise<readonly SessionSummary[]>;
  search(term: ParsedSearchTerm): Promise<readonly SearchResult[]>;
  loadTranscript(sessionId: string): Promise<Transcript>;
  getResumeTarget(sessionId: string): Promise<ResumeTarget | null>;
}
```

A source backend owns:

- Storage discovery for that assistant.
- Parsing source-specific records into canonical contracts.
- Source-specific search implementation when useful for performance.
- Transcript loading and conversion.
- Resume command construction.

A source backend does not own:

- CLI argument parsing.
- Cross-source sorting or grouping.
- Human output formatting.
- JSON output shape decisions beyond canonical contracts.

## Application Services

### Source Registry

Knows which backends are supported and returns the configured built-in sources.

### Discovery Service

Calls all registered sources, tolerates missing/unreadable individual sources, and returns normalized sessions.

### Search Service

Parses the query once, searches all registered sources, merges results, sorts them, and preserves partial results when one source fails.

### Transcript Service

Resolves a user-provided session ID to the correct source/session and loads its canonical transcript.

### Grouping Service

Groups normalized sessions by project and sorts projects/sessions by recency.

### Resume Service

Finds a session, asks its source for a `ResumeTarget`, validates cwd and executable availability, and launches the assistant.

## External Integration Contracts

External integrations should be documented as contracts, not call-site dumps.

### Claude Code

```text
Reads:
- ~/.claude/projects/<encoded-project>/*.jsonl

Launches:
- claude resume mechanism
```

### OpenCode

```text
Reads:
- ~/.local/share/opencode/opencode.db

Depends on:
- OpenCode session/message/part schema details used by the backend

Launches:
- opencode resume mechanism
```

### Codex

```text
Reads:
- ~/.codex/sessions/**/rollout-*.jsonl
- ~/.codex/state_*.sqlite
- ~/.codex/history.jsonl

Launches:
- codex resume mechanism
```

### Terminal Environment

```text
Uses:
- stdout/stderr
- current working directory
- PAGER for long transcript display
```

## Target Module Layout

```text
src/
├── cli/
│   ├── main.ts
│   ├── args.ts
│   └── help.ts
├── commands/
│   ├── list.ts
│   ├── search.ts
│   ├── show.ts
│   └── resume.ts
├── domain/
│   ├── source.ts
│   ├── session.ts
│   ├── transcript.ts
│   ├── search.ts
│   └── resume.ts
├── services/
│   ├── source-registry.ts
│   ├── discovery.ts
│   ├── search.ts
│   ├── transcript.ts
│   ├── grouping.ts
│   └── resume.ts
├── sources/
│   ├── claude/
│   ├── opencode/
│   └── codex/
├── output/
│   ├── human.ts
│   ├── json.ts
│   ├── transcript.ts
│   └── pager.ts
└── shared/
    ├── fs.ts
    ├── paths.ts
    ├── jsonl.ts
    ├── sqlite.ts
    └── errors.ts
```

This layout is a direction, not a requirement to complete in one change. The migration should happen in small, behavior-preserving slices.

## Migration Plan

1. Introduce domain contracts and source backend interface.
2. Move source-neutral helpers into shared/domain modules.
3. Extract one source backend at a time behind the interface.
4. Add a source registry and discovery service.
5. Move list/search/show/resume command orchestration onto services.
6. Normalize transcript rendering through `Transcript` and `TranscriptEntry`.
7. Move output formatting into output modules.
8. Remove obsolete source-specific branches from command code.

## Periodic Review Checklist

After each migration slice, compare the code with this document:

- Did command code become more source-neutral?
- Did source-specific parsing move closer to source backends?
- Did a canonical domain type replace duplicated ad hoc shapes?
- Did dependency direction stay one-way?
- Could a new source be added with fewer changes than before?
- Did behavior remain compatible with existing tests and CLI usage?
