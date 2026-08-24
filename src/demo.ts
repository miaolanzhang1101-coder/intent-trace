import { Effect } from "effect";
import { makeRuntime } from "./runtime.ts";
import { createServer } from "./http/server.ts";

const rt = makeRuntime();
await rt.runPromise(Effect.void);
const PORT = 3999;
const server = createServer(rt, PORT);
const base = `http://localhost:${PORT}`;

const hr = () => console.log("─".repeat(74));
async function call(method: string, path: string, body?: unknown, show = true) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as any;
  if (show) console.log(`\n${method} ${path}  ->  ${res.status}`);
  return { status: res.status, data };
}
const ok = (label: string, cond: boolean) =>
  console.log(`   ${cond ? "✓" : "✗ FAIL"}  ${label}`);

// ---- a tiny JS/TS project with a real null-pointer bug + a dependency ----
const projectFiles = [
  {
    path: "package.json",
    content: JSON.stringify({ name: "demo-svc", version: "1.0.0", dependencies: { lodash: "4.17.20" } }, null, 2),
  },
  {
    path: "src/user.ts",
    content:
      `export function getUserName(user: { name: string } | null): string | undefined {\n` +
      `  return user.name.toUpperCase();\n}\n`,
  },
  {
    path: "src/user.test.ts",
    content:
      `import { expect, test } from "bun:test";\n` +
      `import { getUserName } from "./user.ts";\n\n` +
      `test("uppercases the name", () => {\n` +
      `  expect(getUserName({ name: "ada" })).toBe("ADA");\n});\n`,
  },
  {
    path: "src/api/userController.ts",
    content: `export function handleGetUser(req: any) {\n  return { name: req.query.name };\n}\n`,
  },
];

try {
  hr();
  console.log("FULL FLOW: project → agent → intent → approve → execute (tests) → rollback");
  hr();

  // 1) project + files
  const pid = (await call("POST", "/projects", { name: "demo-svc" })).data.id as string;
  await call("POST", `/projects/${pid}/files`, { files: projectFiles });
  console.log(`   project ${pid} created with ${projectFiles.length} files`);

  // 2) AGENT: three natural-language prompts -> proposed intents
  const A = (await call("POST", `/projects/${pid}/prompts`, { text: "Fix the null pointer in getUserName" })).data;
  console.log(`   A "${A.title}"  risk=${A.risk}  kind=${A.kind}`);
  console.log(`     edits: ${A.edits.map((e: any) => `${e.op} ${e.path}`).join(", ")}`);
  console.log(`     affected: files=${JSON.stringify(A.affected.files)} tests=${JSON.stringify(A.affected.tests)}`);

  const C = (await call("POST", `/projects/${pid}/prompts`, { text: "Upgrade lodash to 4.17.21" })).data;
  console.log(`   C "${C.title}"  risk=${C.risk}  kind=${C.kind}  edits=${C.edits.length}`);

  // 3) approve + execute A -> runs real tests in the sandbox
  await call("POST", `/intents/${A.id}/approve`);
  const execA = (await call("POST", `/intents/${A.id}/execute`)).data;
  console.log(`   executed A -> tests ${execA.execution.passed ? "PASSED" : "FAILED"} (exit ${execA.execution.exitCode}, ${execA.execution.durationMs}ms)`);
  ok("sandbox actually ran the test suite and it passed", execA.execution.passed === true);

  // 4) verify the file on disk was really edited
  const afterFix = (await call("GET", `/projects/${pid}/files/content?path=src/user.ts`, undefined, false)).data;
  ok("src/user.ts now contains the null guard", afterFix.content.includes("if (user == null)"));
  ok("src/user.ts is now version 2", afterFix.version === 2);

  // 5) a second intent that also touches src/user.ts -> depends on A automatically
  const D = (await call("POST", `/projects/${pid}/prompts`, { text: "note in user.ts about logging" })).data;
  console.log(`   D "${D.title}"  dependsOn=${JSON.stringify(D.dependsOn)}`);
  ok("D auto-depends on A (shared file overlap)", D.dependsOn.includes(A.id));
  await call("POST", `/intents/${D.id}/approve`);
  await call("POST", `/intents/${D.id}/execute`);

  // 6) intent graph
  const graph = (await call("GET", `/projects/${pid}/graph`, undefined, false)).data;
  console.log(`   graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // 7) DRY-RUN revert of A -> preview blast radius (D would revert too)
  const dry = (await call("POST", `/intents/${A.id}/revert`, { dry_run: true })).data;
  console.log(`   dry-run revert A: wouldRevert=${dry.wouldRevert.map((x: any) => x.title).join(" -> ")}`);
  ok("dry-run flags D as required_by A", dry.requiredBy.some((x: any) => x.id === D.id));

  // 8) plain revert -> blocked; cascade revert -> restores files
  const blocked = await call("POST", `/intents/${A.id}/revert`, {}, false);
  ok("plain revert of A is blocked (409)", blocked.status === 409);
  const casc = (await call("POST", `/intents/${A.id}/revert`, { cascade: true })).data;
  console.log(`   cascade reverted: ${casc.reverted.length} intents`);

  // 9) verify the file content was truly restored to the original
  const restored = (await call("GET", `/projects/${pid}/files/content?path=src/user.ts`, undefined, false)).data;
  ok("src/user.ts null guard is GONE after cascade revert", !restored.content.includes("if (user == null)"));
  ok("src/user.ts restored to original body", restored.content.includes("return user.name.toUpperCase()"));

  // 10) analytics
  const stats = (await call("GET", "/stats", undefined, false)).data;
  console.log("   event counts:", stats.map((s: any) => `${s.type}=${s.count}`).join("  "));

  hr();
  console.log("Full flow complete.");
  hr();
} catch (e) {
  console.error("DEMO ERROR:", e);
} finally {
  server.stop(true);
  await rt.dispose();
  process.exit(0);
}
