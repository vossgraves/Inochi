import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Both Railway services may deploy together. Serialize their pre-deploy migrations.
const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await client`select pg_advisory_lock(hashtext('inochi:migrations'))`;
  await migrate(drizzle(client), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("PostgreSQL migrations complete.");
} finally {
  await client`select pg_advisory_unlock(hashtext('inochi:migrations'))`.catch(() => undefined);
  await client.end({ timeout: 5 });
}
