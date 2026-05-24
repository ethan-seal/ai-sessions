import { spawnSync } from "node:child_process";

export function outputViaPager(content: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(content);
    return;
  }

  const pagerCmd = process.env.PAGER || "less -R";
  const parts = pagerCmd.split(/\s+/);
  const cmd = parts[0] || "less";
  const pagerArgs = parts.slice(1);

  const result = spawnSync(cmd, pagerArgs, {
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (result.status !== 0 && result.status !== null) {
    process.stdout.write(content);
  }
}
