import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client";

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log("PostgreSQL migrations complete.");
process.exit(0);
