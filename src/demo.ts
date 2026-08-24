import { Effect } from "effect";
import { makeRuntime } from "./runtime.ts";
import { createServer } from "./http/server.ts";

const rt = makeRuntime();
await rt.runPromise(Effect.void); // build layer / run migrations
const PORT = 3999;
const server = createServer(rt, PORT);
const base = `http://localhost:${PORT}`;

let step = 0;
const hr = () => console.log("─".repeat(72));
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as any;
  console.log(`\n[${++step}] ${method} ${path}  ->  ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
  return { status: res.status, data };
}

try {
  hr();
  console.log("INTENT-TRACE BACKEND — end-to-end demo");
  console.log("Scenario: an AI agent makes three dependent intents, then we");
  console.log("trace impact and safely cascade-revert the root decision.");
  hr();

  // 1) Root intent: refactor a SQL query (low risk).
  const a = (
    await call("POST", "/intents", {
      title: "Refactor SQL query",
      kind: "sql",
      risk: "low",
      agent: "claude-agent",
      reasoning: "N+1 query in UserRepo; collapse into a single JOIN.",
      edits: [
        { path: "src/db/UserRepo.java", op: "modify", diff: "@@ -20,7 +20,3 @@\n- // N+1 loop\n+ // single JOIN" },
      ],
    })
  ).data.id as string;

  // 2) Depends on A: update callers to the new API (low risk).
  const b = (
    await call("POST", "/intents", {
      title: "Update callers to new API",
      kind: "api-migration",
      risk: "low",
      agent: "claude-agent",
      reasoning: "UserRepo.findAll signature changed by the refactor.",
      dependsOn: [a],
      edits: [
        { path: "src/service/UserService.java", op: "modify", diff: "@@ call site update @@" },
        { path: "src/api/UserController.java", op: "modify", diff: "@@ call site update @@" },
      ],
    })
  ).data.id as string;

  // 3) Depends on B: fix a type mismatch introduced downstream (HIGH risk).
  const c = (
    await call("POST", "/intents", {
      title: "Fix type mismatch",
      kind: "type-fix",
      risk: "high",
      agent: "claude-agent",
      reasoning: "Return type List<User> vs Stream<User> at the controller.",
      dependsOn: [b],
      edits: [{ path: "src/api/UserController.java", op: "modify", diff: "@@ type fix @@" }],
    })
  ).data.id as string;

  // 4) Apply in dependency order. C is high-risk -> approval gate.
  await call("POST", `/intents/${a}/apply`);
  await call("POST", `/intents/${b}/apply`);
  await call("POST", `/intents/${c}/apply`); // expect 428 ApprovalRequired
  await call("POST", `/intents/${c}/apply`, { approve: true }); // now applied

  // 5) The Intent Graph (nodes + edges) that the UI renders.
  await call("GET", "/intents/graph");

  // 6) DRY-RUN revert of the root A: preview the blast radius, mutate nothing.
  await call("POST", `/intents/${a}/revert`, { dry_run: true });

  // 7) Real revert of A WITHOUT cascade -> blocked (hidden dependents).
  await call("POST", `/intents/${a}/revert`); // expect 409 RevertBlocked

  // 8) Cascade revert -> reverts C, B, A in dependents-first order.
  await call("POST", `/intents/${a}/revert`, { cascade: true });

  // 9) Dependency panel for A: required_by are now reverted ("ghosted").
  await call("GET", `/intents/${a}/dependencies`);

  // 10) Observability: analytics rollup + recent audit events.
  await call("GET", "/stats");
  await call("GET", `/events?intentId=${a}&limit=5`);

  hr();
  console.log("Demo complete.");
  hr();
} finally {
  server.stop(true);
  await rt.dispose();
}
