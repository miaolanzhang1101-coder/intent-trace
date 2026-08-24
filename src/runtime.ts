import { Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { Db } from "./services/Db.ts";
import { Events } from "./services/Events.ts";
import { Intents } from "./services/Intents.ts";

/**
 * Root wiring. `provideMerge` feeds a dependency into the layers above it AND
 * keeps it in the final context. Because `Db.Live` is a single Layer value,
 * Effect memoizes it — every service shares ONE PGlite/Drizzle instance.
 *
 *   Intents  (needs Db + Events)
 *     └── provideMerge Events  (needs Db)      -> output: Intents ∪ Events
 *           └── provideMerge Db                 -> output: Intents ∪ Events ∪ Db
 */
export const AppLayer = Intents.Live.pipe(
  Layer.provideMerge(Events.Live),
  Layer.provideMerge(Db.Live),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
);

export type AppServices = Db | Events | Intents;

/** A ManagedRuntime lets the HTTP layer run Effect programs via runPromise. */
export const makeRuntime = () => ManagedRuntime.make(AppLayer);
export type AppRuntime = ReturnType<typeof makeRuntime>;
