import type { SearchResult } from "../domain/search";
import { parseTerm, snippetAround } from "../domain/search";
import type { ProjectGroup, SessionSummary } from "../domain/session";
import type { Source } from "../domain/source";
import type { TranscriptEntry } from "../domain/transcript";

const MAX_LIST_LABEL = 70;
const MAX_SEARCH_PREVIEW = 100;
const MAX_SHORT_MESSAGE = 200;
const HEADER_WIDTH = 60;

export function renderSessionGroups(
  groups: readonly ProjectGroup[],
  limit?: number,
): string {
  const out: string[] = [];

  for (const group of groups) {
    const count = group.sessions.length;
    const lastActive = formatDateShort(group.lastActiveAt);
    out.push(
      `\n${group.projectDir} (${count} session${count !== 1 ? "s" : ""}, last active: ${lastActive})`,
    );

    const displaySessions = limit
      ? group.sessions.slice(0, limit)
      : group.sessions;
    for (const session of displaySessions) {
      const date = formatDate(session.startedAt);
      const tag = sourceTag(session.source);
      const label =
        session.title || truncate(session.firstMessage, MAX_LIST_LABEL);
      out.push(`  ${date}  ${session.id}  ${tag} "${label}"`);
    }

    if (limit && count > limit) {
      out.push(`  ... and ${count - limit} more`);
    }
  }

  out.push("");
  return out.join("\n");
}

export function renderSearchResults(
  term: string,
  results: readonly SearchResult[],
): string {
  const parsed = parseTerm(term);
  const out: string[] = [
    `\nFound ${results.length} session${results.length !== 1 ? "s" : ""} matching "${term}":`,
    "",
  ];

  for (const result of results) {
    const date = formatDate(result.session.startedAt);
    const tag = sourceTag(result.session.source);
    const preview = snippetAround(
      result.matchedText,
      parsed,
      MAX_SEARCH_PREVIEW,
    );
    out.push(
      `  ${date}  ${result.session.id}  ${tag} ${result.session.projectDir}`,
    );
    out.push(`    [${result.matchRole}] "${preview}"`);
    out.push("");
  }

  return out.join("\n");
}

export function renderTranscript(
  session: SessionSummary,
  entries: readonly TranscriptEntry[],
  short: boolean,
): string {
  const out: string[] = [];
  out.push(`\nSession: ${session.id}`);
  out.push(`Source:  ${session.source}`);
  out.push(`Project: ${session.projectDir}`);
  out.push(`Started: ${formatDate(session.startedAt)}`);
  if (session.title) out.push(`Title:   ${session.title}`);
  out.push(`CWD:     ${session.cwd}`);
  out.push(`${"─".repeat(HEADER_WIDTH)}\n`);

  renderTranscriptEntries(entries, short, out);

  return `${out.join("\n")}\n`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function formatDateShort(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function sourceTag(source: Source): string {
  if (source === "claude") return "[claude]";
  if (source === "opencode") return "[opencode]";
  return "[codex]";
}

function renderTranscriptEntries(
  entries: readonly TranscriptEntry[],
  short: boolean,
  out: string[],
) {
  for (const entry of entries) {
    const role = transcriptRoleLabel(entry);
    const time = entry.timestamp ? formatDate(entry.timestamp) : "";
    const text = entry.text.trim();
    if (!text) continue;

    if (short) {
      out.push(`[${time}] ${role}:`);
      out.push(`  ${truncate(text.replace(/\n/g, " "), MAX_SHORT_MESSAGE)}`);
      out.push("");
      continue;
    }

    out.push(formatMessageHeader(role, time));
    out.push(formatTranscriptEntryText(entry));
    out.push("");
  }
}

function transcriptRoleLabel(entry: TranscriptEntry): string {
  if (entry.role === "user") return "User";
  if (entry.role === "assistant") return "Assistant";
  if (entry.role === "tool_call" || entry.role === "tool_result") return "Tool";
  if (entry.role === "system") return "System";
  return "Unknown";
}

function formatTranscriptEntryText(entry: TranscriptEntry): string {
  if (entry.role === "tool_call" && entry.toolName) {
    return `  [tool_use: ${entry.toolName}]\n${entry.text}`;
  }
  return entry.text.trim();
}

function formatMessageHeader(role: string, time: string): string {
  const label = `── ${role} [${time}] `;
  const padLen = Math.max(0, HEADER_WIDTH - label.length);
  return label + "─".repeat(padLen);
}
