import { Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { Db } from "./services/Db.ts";
import { Events } from "./services/Events.ts";
import { Projects } from "./services/Projects.ts";
import { Agent } from "./services/Agent.ts";
import { Sandbox } from "./services/Sandbox.ts";
import { Intents } from "./services/Intents.ts";

/**
 * Root wiring. `provideMerge` feeds a dependency into the layers above it AND
 * keeps it in the final context. `Db.Live` is a single Layer value, so Effect
 * memoizes it — every service shares ONE PGlite/Drizzle instance.
 *
 *   Intents  (Db, Events, Projects, Agent, Sandbox)
 *     ├── Agent    (Projects)
 *     ├── Events   (Db)
 *     ├── Projects (Db)
 *     ├── Sandbox  (—)
 *     └── Db       (—)
 */
export const AppLayer = Intents.Live.pipe(
  Layer.provideMerge(Agent.Live),
  Layer.provideMerge(Events.Live),
  Layer.provideMerge(Projects.Live),
  Layer.provideMerge(Sandbox.Live),
  Layer.provideMerge(Db.Live),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
);

export type AppServices = Db | Events | Projects | Agent | Sandbox | Intents;

export const makeRuntime = () => ManagedRuntime.make(AppLayer);
export type AppRuntime = ReturnType<typeof makeRuntime>;
