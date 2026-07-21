import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const globalDatabase = globalThis as typeof globalThis & { inochiSql?: ReturnType<typeof postgres> };

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  const client = globalDatabase.inochiSql ?? postgres(url, { max: 10, prepare: false });
  if (process.env.NODE_ENV !== "production") globalDatabase.inochiSql = client;
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

let database: Database | undefined;
export function getDatabase() {
  database ??= createDatabase();
  return database;
}

// Next.js imports route modules while building. Delay the connection until a
// query is actually executed so builds do not require a reachable database.
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const value = getDatabase()[property as keyof Database];
    return typeof value === "function" ? value.bind(getDatabase()) : value;
  },
});
