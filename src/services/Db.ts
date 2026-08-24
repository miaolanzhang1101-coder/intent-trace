import { Effect, Layer } from "effect";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema.ts";
import { applyMigrations } from "../db/migrate.ts";

export type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

const make = Effect.gen(function* () {
  const dataDir = process.env.DATA_DIR; // undefined => ephemeral in-memory Postgres
  // Acquire PGlite as a scoped resource so it's closed on shutdown.
  const pg = yield* Effect.acquireRelease(
    Effect.tryPromise(async () => {
      const client = new PGlite(dataDir);
      await client.waitReady;
      return client;
    }),
    (client) => Effect.promise(() => client.close()),
  );

  yield* Effect.tryPromise(() => applyMigrations(pg));
  yield* Effect.logInfo(
    `database ready (${dataDir ? `persisted: ${dataDir}` : "in-memory PGlite"})`,
  );

  const db = drizzle(pg, { schema });

  return { db, pg, schema } as const;
});

export class Db extends Effect.Tag("Db")<
  Db,
  Effect.Effect.Success<typeof make>
>() {
  static readonly Live = Layer.scoped(Db, make);
}
