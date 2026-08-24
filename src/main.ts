import { Effect } from "effect";
import { makeRuntime } from "./runtime.ts";
import { createServer } from "./http/server.ts";

const rt = makeRuntime();

// Force the layer to build now so migrations run (and errors surface) at boot.
await rt.runPromise(Effect.logInfo("starting intent-backend..."));

const port = Number(process.env.PORT ?? 3000);
const server = createServer(rt, port);
console.log(`intent-backend listening on http://localhost:${server.port}`);
console.log("routes:");
for (const line of [
  "GET  /health",
  "POST /projects                         create a project",
  "POST /projects/:id/files               upload/replace files (versioned)",
  "GET  /projects/:id/files[/content]     list files / read content?path=",
  "GET  /projects/:id/files/history       file version history?path=",
  "POST /projects/:id/prompts             AGENT: NL prompt -> proposed intent",
  "GET  /projects/:id/intents             list intents for a project",
  "GET  /projects/:id/graph               semantic intent graph",
  "GET  /projects/:id/stream              realtime SSE for the project",
  "GET  /intents/:id                      intent + edits + deps + executions",
  "GET  /intents/:id/dependencies         depends_on + required_by",
  "POST /intents/:id/approve              proposed -> approved (approve=true if high-risk)",
  "POST /intents/:id/execute              apply edits + snapshot + run tests",
  "POST /intents/:id/revert               dry_run + cascade rollback (restores files)",
  "GET  /intents/:id/stream               realtime SSE for one intent",
  "GET  /events   /stats                  audit log + analytics",
])
  console.log("  " + line);

const shutdown = async () => {
  console.log("\nshutting down...");
  server.stop(true);
  await rt.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
