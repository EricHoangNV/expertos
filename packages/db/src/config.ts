/**
 * Resolves the Postgres connection string from the environment.
 * Centralized so the API, migrations, and seed scripts agree on one source.
 */
export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}
