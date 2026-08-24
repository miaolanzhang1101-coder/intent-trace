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
  "POST /intents                         create intent (+edits, +dependsOn)",
  "GET  /intents?workspaceId=            list intents",
  "GET  /intents/graph                   nodes+edges for the Intent Graph",
  "GET  /intents/:id                     intent + edits + deps + commits",
  "GET  /intents/:id/dependencies        depends_on + required_by (direct+transitive)",
  "POST /intents/:id/dependencies        add a dependency edge",
  "POST /intents/:id/apply               apply (approve=true for high-risk)",
  "POST /intents/:id/revert              dry_run + cascade rollback",
  "POST /intents/:id/commits             attach a git commit",
  "GET  /intents/:id/stream              realtime SSE event stream",
  "GET  /events   /stats                 audit log + analytics",
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
