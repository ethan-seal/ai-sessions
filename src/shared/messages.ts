/** True for user messages that are harness noise (slash-command wrappers, injected context), not real prompts. */
export function isMetaOrCommand(text: string): boolean {
  return (
    text.startsWith("<command-name>") ||
    text.startsWith("<command-message>") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<turn_aborted>") ||
    text.startsWith("<local-command-stdout>") ||
    text.startsWith("Caveat: The messages below") ||
    text.trim() === ""
  );
}

/** Collapses newlines so a message fits on one line of output. */
export function singleLine(text: string): string {
  return text.replace(/\n/g, " ").trim();
}
