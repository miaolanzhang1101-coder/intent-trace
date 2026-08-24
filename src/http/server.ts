import { Effect, Stream, Fiber } from "effect";
import type { AppRuntime } from "../runtime.ts";
import { Intents } from "../services/Intents.ts";
import { Events } from "../services/Events.ts";
import { Projects } from "../services/Projects.ts";
import { json, errorResponse, truthy } from "./http.ts";

const readBody = async (req: Request): Promise<any> => {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const run = async <A>(rt: AppRuntime, program: Effect.Effect<A, any, any>, ok = 200) => {
  try {
    const result = await rt.runPromise(Effect.either(program));
    const res = result._tag === "Left" ? errorResponse(result.left) : json(result.right, ok);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  } catch (err) {
    const res = json({ error: "InternalError", message: String(err) }, 500);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
};

const sse = (
  rt: AppRuntime,
  req: Request,
  filter: { intentId?: string; workspaceId?: string },
) => {
  return (async () => {
    const events = await rt.runPromise(Events);
    const enc = new TextEncoder();
    let fiber: Fiber.RuntimeFiber<any, any> | undefined;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(`event: open\ndata: ${JSON.stringify(filter)}\n\n`));
        const program = Stream.runForEach(events.stream(filter), (e) =>
          Effect.sync(() => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))),
        ).pipe(Effect.catchAll(() => Effect.void));
        fiber = rt.runFork(program);
        req.signal.addEventListener("abort", () => {
          if (fiber) rt.runFork(Fiber.interrupt(fiber));
          try {
            controller.close();
          } catch {}
        });
      },
      cancel() {
        if (fiber) rt.runFork(Fiber.interrupt(fiber));
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...CORS,
      },
    });
  })();
};

export function createServer(rt: AppRuntime, port = Number(process.env.PORT ?? 3000)) {
  return Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method.toUpperCase();
      const seg = path.split("/").filter(Boolean);
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

      if (path === "/" || path === "/health")
        return json({ ok: true, service: "intent-backend", time: new Date().toISOString() }, 200);

      // ---- global observability ------------------------------------------
      if (path === "/stats" && method === "GET")
        return run(rt, Effect.flatMap(Events, (e) => e.countsByType()));
      if (path === "/events" && method === "GET") {
        const intentId = url.searchParams.get("intentId") ?? undefined;
        const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
        const limit = Number(url.searchParams.get("limit") ?? 100);
        return run(rt, Effect.flatMap(Events, (e) => e.recent({ intentId, workspaceId, limit })));
      }

      // ---- projects ------------------------------------------------------
      if (seg[0] === "projects" && seg.length === 1) {
        if (method === "POST") {
          const body = await readBody(req);
          if (!body?.name) return json({ error: "BadRequest", message: "name is required" }, 400);
          return run(rt, Effect.flatMap(Projects, (p) => p.create(body.name, body.testCommand)), 201);
        }
        if (method === "GET") return run(rt, Effect.flatMap(Projects, (p) => p.list()));
      }

      if (seg[0] === "projects" && seg[1] && seg.length >= 2) {
        const pid = seg[1];
        const sub = seg[2];

        if (!sub && method === "GET") return run(rt, Effect.flatMap(Projects, (p) => p.get(pid)));

        // files
        if (sub === "files" && seg.length === 3) {
          if (method === "POST") {
            const body = await readBody(req);
            const inputs = body?.files ?? [];
            if (!Array.isArray(inputs) || inputs.length === 0)
              return json({ error: "BadRequest", message: "files[] is required" }, 400);
            return run(
              rt,
              Effect.flatMap(Projects, (p) =>
                p.putFiles(pid, inputs).pipe(Effect.flatMap(() => p.listFiles(pid))),
              ),
              201,
            );
          }
          if (method === "GET") return run(rt, Effect.flatMap(Projects, (p) => p.listFiles(pid)));
        }
        if (sub === "files" && seg[3] === "content" && method === "GET") {
          const p = url.searchParams.get("path") ?? "";
          return run(rt, Effect.flatMap(Projects, (svc) => svc.readFile(pid, p)));
        }
        if (sub === "files" && seg[3] === "history" && method === "GET") {
          const p = url.searchParams.get("path") ?? "";
          return run(rt, Effect.flatMap(Projects, (svc) => svc.history(pid, p)));
        }

        // agent prompt -> proposed intent
        if (sub === "prompts" && method === "POST") {
          const body = await readBody(req);
          if (!body?.text) return json({ error: "BadRequest", message: "text is required" }, 400);
          return run(rt, Effect.flatMap(Intents, (s) => s.proposeFromPrompt(pid, body.text)), 201);
        }

        // project-scoped intent list + graph + stream
        if (sub === "intents" && method === "GET")
          return run(rt, Effect.flatMap(Intents, (s) => s.list(pid)));
        if (sub === "graph" && method === "GET")
          return run(rt, Effect.flatMap(Intents, (s) => s.graph(pid)));
        if (sub === "stream" && method === "GET") return sse(rt, req, { workspaceId: pid });
      }

      // ---- intents -------------------------------------------------------
      if (seg[0] === "intents" && seg.length === 1) {
        if (method === "POST") {
          const body = await readBody(req);
          if (!body?.title) return json({ error: "BadRequest", message: "title is required" }, 400);
          return run(rt, Effect.flatMap(Intents, (s) => s.create(body)), 201);
        }
        if (method === "GET") {
          const ws = url.searchParams.get("workspaceId") ?? "default";
          return run(rt, Effect.flatMap(Intents, (s) => s.list(ws)));
        }
      }
      if (seg[0] === "intents" && seg[1] === "graph" && seg.length === 2 && method === "GET") {
        const ws = url.searchParams.get("workspaceId") ?? "default";
        return run(rt, Effect.flatMap(Intents, (s) => s.graph(ws)));
      }

      if (seg[0] === "intents" && seg[1] && seg.length >= 2) {
        const id = seg[1];
        const sub = seg[2];

        if (!sub && method === "GET") return run(rt, Effect.flatMap(Intents, (s) => s.get(id)));
        if (sub === "dependencies" && method === "GET")
          return run(rt, Effect.flatMap(Intents, (s) => s.dependencies(id)));
        if (sub === "dependencies" && method === "POST") {
          const body = await readBody(req);
          const dependsOn: string[] = body?.dependsOn ?? (body?.dependsOnId ? [body.dependsOnId] : []);
          if (dependsOn.length === 0)
            return json({ error: "BadRequest", message: "dependsOn is required" }, 400);
          return run(
            rt,
            Effect.flatMap(Intents, (s) =>
              Effect.forEach(dependsOn, (d) => s.addDependency(id, d)).pipe(
                Effect.flatMap(() => s.dependencies(id)),
              ),
            ),
          );
        }
        if (sub === "approve" && method === "POST") {
          const body = await readBody(req);
          const approve = truthy(url.searchParams.get("approve")) || body?.approve === true;
          return run(rt, Effect.flatMap(Intents, (s) => s.approve(id, { approve })));
        }
        if (sub === "execute" && method === "POST")
          return run(rt, Effect.flatMap(Intents, (s) => s.execute(id)));
        if (sub === "revert" && method === "POST") {
          const body = await readBody(req);
          const cascade = truthy(url.searchParams.get("cascade")) || body?.cascade === true;
          const dryRun =
            truthy(url.searchParams.get("dry_run")) ||
            truthy(url.searchParams.get("dryRun")) ||
            body?.dry_run === true ||
            body?.dryRun === true;
          return run(rt, Effect.flatMap(Intents, (s) => s.revert(id, { cascade, dryRun })));
        }
        if (sub === "commits" && method === "POST") {
          const body = await readBody(req);
          if (!body?.sha) return json({ error: "BadRequest", message: "sha is required" }, 400);
          return run(
            rt,
            Effect.flatMap(Intents, (s) =>
              s.attachCommit(id, body.sha, body.message ?? "").pipe(Effect.map(() => ({ ok: true, sha: body.sha }))),
            ),
          );
        }
        if (sub === "stream" && method === "GET") return sse(rt, req, { intentId: id });
      }

      return json({ error: "NotFound", path, method }, 404);
    },
  });
}
