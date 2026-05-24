export function sessionCutoff(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
