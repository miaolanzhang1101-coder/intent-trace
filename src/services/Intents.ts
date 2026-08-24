import { Effect, Layer } from "effect";
import { and, eq, inArray, desc } from "drizzle-orm";
import { Db } from "./Db.ts";
import { Events } from "./Events.ts";
import { Projects } from "./Projects.ts";
import { Agent } from "./Agent.ts";
import { Sandbox } from "./Sandbox.ts";
import {
  intents,
  edits,
  intentDependencies,
  commits,
  snapshots,
  executions,
} from "../db/schema.ts";
import type { Intent, Edit } from "../db/schema.ts";
import {
  IntentNotFound,
  RevertBlocked,
  ApplyBlocked,
  ApprovalRequired,
  InvalidState,
  CycleDetected,
  BadRequest,
} from "../domain/errors.ts";
import * as G from "../domain/graph.ts";
import { moduleOf, isTestFile } from "../domain/diff.ts";

let counter = 0;
const newId = (p: string) =>
  `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const shortSha = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 6);

export interface EditInput {
  readonly path: string;
  readonly op?: "create" | "modify" | "delete";
  readonly diff?: string;
  readonly newContent?: string;
}
export interface CreateInput {
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly title: string;
  readonly description?: string;
  readonly kind?: string;
  readonly risk?: "low" | "high";
  readonly agent?: string;
  readonly reasoning?: string;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly edits?: ReadonlyArray<EditInput>;
  readonly affected?: { files?: string[]; modules?: string[]; tests?: string[] };
}

const make = Effect.gen(function* () {
  const { db } = yield* Db;
  const events = yield* Events;
  const projects = yield* Projects;
  const agent = yield* Agent;
  const sandbox = yield* Sandbox;

  const getRaw = (id: string) =>
    Effect.tryPromise(() => db.select().from(intents).where(eq(intents.id, id)).limit(1)).pipe(
      Effect.orDie,
      Effect.flatMap((rows) =>
        rows.length > 0 ? Effect.succeed(rows[0]!) : Effect.fail(new IntentNotFound({ id })),
      ),
    );

  const loadWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const nodes = yield* Effect.tryPromise(() =>
        db.select().from(intents).where(eq(intents.workspaceId, workspaceId)),
      ).pipe(Effect.orDie);
      const ids = nodes.map((n) => n.id);
      const deps =
        ids.length === 0
          ? []
          : yield* Effect.tryPromise(() =>
              db.select().from(intentDependencies).where(inArray(intentDependencies.intentId, ids)),
            ).pipe(Effect.orDie);
      const edges: G.Edge[] = deps.map((d) => ({ intentId: d.intentId, dependsOnId: d.dependsOnId }));
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return { nodes, edges, byId };
    });

  const brief = (byId: Map<string, Intent>, id: string) => {
    const n = byId.get(id);
    return { id, title: n?.title ?? id, status: n?.status ?? "unknown", risk: n?.risk ?? "low" };
  };

  const create = (input: CreateInput) =>
    Effect.gen(function* () {
      const workspaceId = input.workspaceId ?? input.projectId ?? "default";
      const id = newId("int");
      const deps = input.dependsOn ?? [];

      yield* Effect.tryPromise(() =>
        db.insert(intents).values({
          id,
          workspaceId,
          projectId: input.projectId ?? null,
          title: input.title,
          description: input.description ?? "",
          kind: input.kind ?? "edit",
          risk: input.risk ?? "low",
          agent: input.agent ?? "unknown",
          reasoning: input.reasoning ?? "",
          affected: input.affected ?? {},
          status: "proposed",
        }),
      ).pipe(Effect.orDie);

      if (input.edits && input.edits.length > 0) {
        yield* Effect.tryPromise(() =>
          db.insert(edits).values(
            input.edits!.map((e) => ({
              id: newId("edit"),
              intentId: id,
              path: e.path,
              op: e.op ?? "modify",
              diff: e.diff ?? "",
              newContent: e.newContent ?? "",
            })),
          ),
        ).pipe(Effect.orDie);
      }
      if (deps.length > 0) {
        yield* Effect.tryPromise(() =>
          db.insert(intentDependencies).values(deps.map((d) => ({ intentId: id, dependsOnId: d }))),
        ).pipe(Effect.orDie);
      }
      yield* events.emit({
        type: "intent.created",
        intentId: id,
        workspaceId,
        payload: { title: input.title, risk: input.risk ?? "low", dependsOn: deps },
      });
      return yield* getRaw(id);
    });

  const deriveImpact = (projectId: string, paths: string[]) =>
    Effect.gen(function* () {
      const projectFiles = yield* projects.listFiles(projectId);
      const modules = [...new Set(paths.map(moduleOf))].sort();
      const editedTests = paths.filter(isTestFile);
      const bases = paths
        .filter((p) => !isTestFile(p))
        .map((p) => p.split("/").pop()!.replace(/\.\w+$/, ""));
      const referencing = projectFiles
        .filter((f) => isTestFile(f.path) && bases.some((b) => b && f.content.includes(b)))
        .map((f) => f.path);
      const tests = [...new Set([...editedTests, ...referencing])].sort();
      return { files: [...new Set(paths)].sort(), modules, tests };
    });

  const deriveDependencies = (projectId: string, paths: string[]) =>
    Effect.gen(function* () {
      const candidates = yield* Effect.tryPromise(() =>
        db
          .select()
          .from(intents)
          .where(and(eq(intents.workspaceId, projectId), inArray(intents.status, ["approved", "executed"])))
          .orderBy(desc(intents.createdAt)),
      ).pipe(Effect.orDie);
      const pathSet = new Set(paths);
      const deps = new Set<string>();
      for (const c of candidates) {
        const files = ((c.affected as any)?.files ?? []) as string[];
        if (files.some((f) => pathSet.has(f))) deps.add(c.id);
      }
      return [...deps];
    });

  const proposeFromPrompt = (projectId: string, prompt: string) =>
    Effect.gen(function* () {
      const project = yield* projects.get(projectId);
      if (!project) return yield* Effect.fail(new BadRequest({ message: `unknown project ${projectId}` }));

      const progress = (message: string, extra?: Record<string, unknown>) =>
        events.emit({ type: "agent.progress", workspaceId: projectId, payload: { message, ...extra } });

      yield* progress("analyzing prompt", { prompt });
      yield* Effect.sleep("120 millis");
      yield* progress("reading project files");
      const proposal = yield* agent.propose(projectId, prompt);
      yield* Effect.sleep("120 millis");
      yield* progress("generating code edits", { edits: proposal.edits.length });

      const paths = proposal.edits.map((e) => e.path);
      const affected = yield* deriveImpact(projectId, paths);
      const dependsOn = yield* deriveDependencies(projectId, paths);
      yield* progress("computing impact + dependencies", {
        files: affected.files.length,
        dependsOn: dependsOn.length,
        risk: proposal.risk,
      });

      const intent = yield* create({
        projectId,
        workspaceId: projectId,
        title: proposal.title,
        kind: proposal.kind,
        risk: proposal.risk,
        agent: "agent",
        reasoning: proposal.reasoning,
        description: prompt,
        dependsOn,
        affected,
        edits: proposal.edits.map((e) => ({
          path: e.path,
          op: e.op,
          diff: e.diff,
          newContent: e.newContent,
        })),
      });
      yield* progress("proposal ready", { intentId: intent.id, status: "proposed" });
      return yield* get(intent.id);
    });

  const get = (id: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      const [editRows, depRows, dependentRows, commitRows, execRows] = yield* Effect.all([
        Effect.tryPromise(() => db.select().from(edits).where(eq(edits.intentId, id))).pipe(Effect.orDie),
        Effect.tryPromise(() =>
          db.select().from(intentDependencies).where(eq(intentDependencies.intentId, id)),
        ).pipe(Effect.orDie),
        Effect.tryPromise(() =>
          db.select().from(intentDependencies).where(eq(intentDependencies.dependsOnId, id)),
        ).pipe(Effect.orDie),
        Effect.tryPromise(() => db.select().from(commits).where(eq(commits.intentId, id))).pipe(Effect.orDie),
        Effect.tryPromise(() =>
          db.select().from(executions).where(eq(executions.intentId, id)).orderBy(desc(executions.startedAt)),
        ).pipe(Effect.orDie),
      ]);
      return {
        ...intent,
        edits: editRows,
        dependsOn: depRows.map((d) => d.dependsOnId),
        requiredBy: dependentRows.map((d) => d.intentId),
        commits: commitRows,
        executions: execRows,
      };
    });

  const list = (workspaceId = "default") =>
    Effect.tryPromise(() =>
      db.select().from(intents).where(eq(intents.workspaceId, workspaceId)).orderBy(desc(intents.createdAt)),
    ).pipe(Effect.orDie);

  const dependencies = (id: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      const { edges, byId } = yield* loadWorkspace(intent.workspaceId);
      return {
        id,
        dependsOn: {
          direct: G.directDependencies(id, edges).map((d) => brief(byId, d)),
          transitive: G.transitiveDependencies(id, edges).map((d) => brief(byId, d)),
        },
        requiredBy: {
          direct: G.directDependents(id, edges).map((d) => brief(byId, d)),
          transitive: G.transitiveDependents(id, edges).map((d) => brief(byId, d)),
        },
      };
    });

  const graph = (workspaceId = "default") =>
    Effect.gen(function* () {
      const { nodes, edges } = yield* loadWorkspace(workspaceId);
      return {
        nodes: nodes.map((n) => ({
          id: n.id,
          title: n.title,
          status: n.status,
          risk: n.risk,
          kind: n.kind,
          affected: n.affected,
        })),
        edges: edges.map((e) => ({ from: e.intentId, to: e.dependsOnId })),
      };
    });

  const addDependency = (intentId: string, dependsOnId: string) =>
    Effect.gen(function* () {
      const from = yield* getRaw(intentId);
      yield* getRaw(dependsOnId);
      const { edges } = yield* loadWorkspace(from.workspaceId);
      const cycle = G.findCyclePath(intentId, dependsOnId, edges);
      if (cycle)
        return yield* Effect.fail(new CycleDetected({ from: intentId, to: dependsOnId, path: cycle }));
      yield* Effect.tryPromise(() =>
        db.insert(intentDependencies).values({ intentId, dependsOnId }).onConflictDoNothing(),
      ).pipe(Effect.orDie);
      yield* events.emit({ type: "dependency.added", intentId, workspaceId: from.workspaceId, payload: { dependsOnId } });
    });

  const approve = (id: string, opts?: { approve?: boolean }) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      if (intent.status === "approved" || intent.status === "executed") return intent;
      if (intent.status !== "proposed")
        return yield* Effect.fail(new InvalidState({ id, status: intent.status, action: "approve" }));
      if (intent.risk === "high" && !opts?.approve)
        return yield* Effect.fail(new ApprovalRequired({ id }));
      yield* Effect.tryPromise(() =>
        db.update(intents).set({ status: "approved", approvedAt: new Date() }).where(eq(intents.id, id)),
      ).pipe(Effect.orDie);
      yield* events.emit({
        type: "intent.approved",
        intentId: id,
        workspaceId: intent.workspaceId,
        payload: { risk: intent.risk, approved: !!opts?.approve },
      });
      return yield* getRaw(id);
    });

  const execute = (id: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      if (intent.status === "executed") return yield* get(id);
      if (intent.status !== "approved")
        return yield* Effect.fail(new InvalidState({ id, status: intent.status, action: "execute" }));

      const directDeps = yield* Effect.tryPromise(() =>
        db.select().from(intentDependencies).where(eq(intentDependencies.intentId, id)),
      ).pipe(Effect.orDie);
      if (directDeps.length > 0) {
        const depStates = yield* Effect.tryPromise(() =>
          db.select().from(intents).where(inArray(intents.id, directDeps.map((d) => d.dependsOnId))),
        ).pipe(Effect.orDie);
        const missing = depStates.filter((d) => d.status !== "executed").map((d) => d.id);
        if (missing.length > 0) return yield* Effect.fail(new ApplyBlocked({ id, missingDependencies: missing }));
      }

      const editRows = yield* Effect.tryPromise(() =>
        db.select().from(edits).where(eq(edits.intentId, id)),
      ).pipe(Effect.orDie);
      const projectId = intent.projectId;

      if (projectId) {
        for (const e of editRows) {
          const current = yield* projects.readFile(projectId, e.path);
          yield* Effect.tryPromise(() =>
            db.insert(snapshots).values({
              id: newId("snap"),
              intentId: id,
              path: e.path,
              prevExisted: current ? "true" : "false",
              prevContent: current ? current.content : null,
            }),
          ).pipe(Effect.orDie);
        }
        for (const e of editRows) {
          if (e.op === "delete") yield* projects.deleteFile(projectId, e.path);
          else yield* projects.writeFile(projectId, e.path, e.newContent, id);
        }
      }

      const sha = shortSha();
      yield* Effect.tryPromise(() =>
        db.update(intents).set({ status: "executed", appliedAt: new Date(), revertedAt: null }).where(eq(intents.id, id)),
      ).pipe(Effect.orDie);
      yield* Effect.tryPromise(() =>
        db.insert(commits).values({ sha, intentId: id, message: `execute: ${intent.title}` }),
      ).pipe(Effect.orDie);
      yield* events.emit({ type: "intent.executed", intentId: id, workspaceId: intent.workspaceId, payload: { sha } });

      let execution: any = null;
      if (projectId) {
        const project = yield* projects.get(projectId);
        const command = project?.testCommand ?? "bun test";
        const execId = newId("exec");
        yield* Effect.tryPromise(() =>
          db.insert(executions).values({ id: execId, intentId: id, projectId, status: "running", command }),
        ).pipe(Effect.orDie);
        yield* events.emit({ type: "execution.started", intentId: id, workspaceId: intent.workspaceId, payload: { execId, command } });

        const fileMap = yield* projects.readAll(projectId);
        const result = yield* sandbox.run(fileMap, command);
        const status = result.passed ? "passed" : "failed";
        yield* Effect.tryPromise(() =>
          db
            .update(executions)
            .set({
              status,
              exitCode: result.exitCode,
              passed: result.passed ? "true" : "false",
              output: result.output,
              finishedAt: new Date(),
            })
            .where(eq(executions.id, execId)),
        ).pipe(Effect.orDie);
        execution = {
          id: execId,
          status,
          passed: result.passed,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: result.output,
        };
        yield* events.emit({
          type: "execution.finished",
          intentId: id,
          workspaceId: intent.workspaceId,
          payload: { execId, status, passed: result.passed, durationMs: result.durationMs },
        });
      }

      const full = yield* get(id);
      return { ...full, execution } as typeof full & { execution: any };
    });

  const revert = (id: string, opts?: { cascade?: boolean; dryRun?: boolean }) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      if (intent.status !== "executed")
        return yield* Effect.fail(new InvalidState({ id, status: intent.status, action: "revert" }));

      const { edges, byId } = yield* loadWorkspace(intent.workspaceId);
      const impacted = G.transitiveDependents(id, edges).filter((d) => byId.get(d)?.status === "executed");
      const planSet = [id, ...impacted];
      const order = G.topoOrder(planSet, edges).reverse();

      const editRows =
        planSet.length === 0
          ? []
          : yield* Effect.tryPromise(() =>
              db.select().from(edits).where(inArray(edits.intentId, planSet)),
            ).pipe(Effect.orDie);
      const affectedFiles = [...new Set(editRows.map((e: Edit) => e.path))].sort();

      const plan = {
        target: id,
        cascade: !!opts?.cascade,
        wouldRevert: order.map((x) => brief(byId, x)),
        requiredBy: impacted.map((x) => brief(byId, x)),
        affectedFiles,
        blocked: impacted.length > 0 && !opts?.cascade,
      };
      if (opts?.dryRun) return { dryRun: true as const, ...plan };
      if (impacted.length > 0 && !opts?.cascade)
        return yield* Effect.fail(new RevertBlocked({ id, requiredBy: impacted }));

      for (const x of order) {
        const node = byId.get(x);
        const projectId = node?.projectId ?? null;
        if (projectId) {
          const snaps = yield* Effect.tryPromise(() =>
            db.select().from(snapshots).where(eq(snapshots.intentId, x)),
          ).pipe(Effect.orDie);
          for (const s of snaps) {
            if (s.prevExisted === "false") yield* projects.deleteFile(projectId, s.path);
            else yield* projects.writeFile(projectId, s.path, s.prevContent ?? "", x);
          }
        }
        yield* Effect.tryPromise(() =>
          db.update(intents).set({ status: "reverted", revertedAt: new Date() }).where(eq(intents.id, x)),
        ).pipe(Effect.orDie);
        yield* events.emit({
          type: "intent.reverted",
          intentId: x,
          workspaceId: intent.workspaceId,
          payload: { partOfCascade: order.length > 1, target: id },
        });
      }
      if (order.length > 1)
        yield* events.emit({
          type: "revert.cascade",
          intentId: id,
          workspaceId: intent.workspaceId,
          payload: { reverted: order, count: order.length },
        });

      return { dryRun: false as const, target: id, cascade: !!opts?.cascade, reverted: order, affectedFiles };
    });

  const attachCommit = (id: string, sha: string, message: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      yield* Effect.tryPromise(() =>
        db.insert(commits).values({ sha, intentId: id, message }).onConflictDoNothing(),
      ).pipe(Effect.orDie);
      yield* events.emit({ type: "commit.attached", intentId: id, workspaceId: intent.workspaceId, payload: { sha, message } });
    });

  return {
    create,
    proposeFromPrompt,
    addDependency,
    get,
    list,
    dependencies,
    graph,
    approve,
    execute,
    revert,
    attachCommit,
  } as const;
});

export class Intents extends Effect.Tag("Intents")<Intents, Effect.Effect.Success<typeof make>>() {
  static readonly Live = Layer.effect(Intents, make);
}
