import { existsSync } from "node:fs";

/** Loads ./.env if present (Node >= 22 built-in), so scripts use the same settings as the server. */
export function loadDotEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
