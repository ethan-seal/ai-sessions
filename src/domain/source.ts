export const SOURCES = ["claude", "opencode", "codex"] as const;

export type Source = (typeof SOURCES)[number];
