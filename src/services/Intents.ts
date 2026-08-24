import { Effect, Layer } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { Db } from "./Db.ts";
import { Events } from "./Events.ts";
import { intents, edits, intentDependencies, commits } from "../db/schema.ts";
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

let counter = 0;
const newId = (p: string) =>
  `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
const shortSha = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 6);

export interface EditInput {
  readonly path: string;
  readonly op?: "create" | "modify" | "delete";
  readonly diff?: string;
}
export interface CreateInput {
  readonly workspaceId?: string;
  readonly title: string;
  readonly description?: string;
  readonly kind?: string;
  readonly risk?: "low" | "high";
  readonly agent?: string;
  readonly reasoning?: string;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly edits?: ReadonlyArray<EditInput>;
}

const make = Effect.gen(function* () {
  const { db } = yield* Db;
  const events = yield* Events;

  const getRaw = (id: string) =>
    Effect.tryPromise(() =>
      db.select().from(intents).where(eq(intents.id, id)).limit(1),
    ).pipe(
      Effect.orDie,
      Effect.flatMap((rows) =>
        rows.length > 0 ? Effect.succeed(rows[0]!) : Effect.fail(new IntentNotFound({ id })),
      ),
    );

  /** Load the dependency edges + intent status map for a workspace. */
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
              db
                .select()
                .from(intentDependencies)
                .where(inArray(intentDependencies.intentId, ids)),
            ).pipe(Effect.orDie);
      const edges: G.Edge[] = deps.map((d) => ({
        intentId: d.intentId,
        dependsOnId: d.dependsOnId,
      }));
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return { nodes, edges, byId };
    });

  const brief = (byId: Map<string, Intent>, id: string) => {
    const n = byId.get(id);
    return { id, title: n?.title ?? id, status: n?.status ?? "unknown", risk: n?.risk ?? "low" };
  };

  // ---- create -------------------------------------------------------------
  const create = (input: CreateInput) =>
    Effect.gen(function* () {
      const workspaceId = input.workspaceId ?? "default";
      const id = newId("int");

      // Validate declared dependencies exist in the same workspace.
      const deps = input.dependsOn ?? [];
      if (deps.length > 0) {
        const found = yield* Effect.tryPromise(() =>
          db
            .select({ id: intents.id })
            .from(intents)
            .where(and(eq(intents.workspaceId, workspaceId), inArray(intents.id, [...deps]))),
        ).pipe(Effect.orDie);
        const foundIds = new Set(found.map((f) => f.id));
        const missing = deps.filter((d) => !foundIds.has(d));
        if (missing.length > 0)
          return yield* Effect.fail(
            new BadRequest({ message: `unknown dependencies: ${missing.join(", ")}` }),
          );
      }

      yield* Effect.tryPromise(() =>
        db.insert(intents).values({
          id,
          workspaceId,
          title: input.title,
          description: input.description ?? "",
          kind: input.kind ?? "edit",
          risk: input.risk ?? "low",
          agent: input.agent ?? "unknown",
          reasoning: input.reasoning ?? "",
          status: "pending",
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
            })),
          ),
        ).pipe(Effect.orDie);
      }

      if (deps.length > 0) {
        yield* Effect.tryPromise(() =>
          db
            .insert(intentDependencies)
            .values(deps.map((d) => ({ intentId: id, dependsOnId: d }))),
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

  // ---- add dependency (with cycle check) ---------------------------------
  const addDependency = (intentId: string, dependsOnId: string) =>
    Effect.gen(function* () {
      const from = yield* getRaw(intentId);
      yield* getRaw(dependsOnId);
      const { edges } = yield* loadWorkspace(from.workspaceId);
      const cycle = G.findCyclePath(intentId, dependsOnId, edges);
      if (cycle)
        return yield* Effect.fail(
          new CycleDetected({ from: intentId, to: dependsOnId, path: cycle }),
        );
      yield* Effect.tryPromise(() =>
        db
          .insert(intentDependencies)
          .values({ intentId, dependsOnId })
          .onConflictDoNothing(),
      ).pipe(Effect.orDie);
      yield* events.emit({
        type: "dependency.added",
        intentId,
        workspaceId: from.workspaceId,
        payload: { dependsOnId },
      });
    });

  // ---- reads --------------------------------------------------------------
  const get = (id: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      const [editRows, depRows, dependentRows, commitRows] = yield* Effect.all([
        Effect.tryPromise(() => db.select().from(edits).where(eq(edits.intentId, id))).pipe(
          Effect.orDie,
        ),
        Effect.tryPromise(() =>
          db.select().from(intentDependencies).where(eq(intentDependencies.intentId, id)),
        ).pipe(Effect.orDie),
        Effect.tryPromise(() =>
          db.select().from(intentDependencies).where(eq(intentDependencies.dependsOnId, id)),
        ).pipe(Effect.orDie),
        Effect.tryPromise(() => db.select().from(commits).where(eq(commits.intentId, id))).pipe(
          Effect.orDie,
        ),
      ]);
      return {
        ...intent,
        edits: editRows,
        dependsOn: depRows.map((d) => d.dependsOnId),
        requiredBy: dependentRows.map((d) => d.intentId),
        commits: commitRows,
      };
    });

  const list = (workspaceId = "default") =>
    Effect.tryPromise(() =>
      db.select().from(intents).where(eq(intents.workspaceId, workspaceId)),
    ).pipe(Effect.orDie);

  /** Backs GET /intents/:id/dependencies — the dependency panel data shape. */
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

  /** Nodes + edges for the Intent Graph visualization. */
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
        })),
        edges: edges.map((e) => ({ from: e.intentId, to: e.dependsOnId })),
      };
    });

  // ---- apply --------------------------------------------------------------
  const apply = (id: string, opts?: { approve?: boolean }) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      if (intent.status === "applied") return intent; // idempotent
      if (intent.status !== "pending" && intent.status !== "reverted")
        return yield* Effect.fail(
          new InvalidState({ id, status: intent.status, action: "apply" }),
        );

      // All direct dependencies must be applied before this intent can apply.
      const directDeps = yield* Effect.tryPromise(() =>
        db.select().from(intentDependencies).where(eq(intentDependencies.intentId, id)),
      ).pipe(Effect.orDie);
      if (directDeps.length > 0) {
        const depIds = directDeps.map((d) => d.dependsOnId);
        const depStates = yield* Effect.tryPromise(() =>
          db.select().from(intents).where(inArray(intents.id, depIds)),
        ).pipe(Effect.orDie);
        const missing = depStates.filter((d) => d.status !== "applied").map((d) => d.id);
        if (missing.length > 0)
          return yield* Effect.fail(new ApplyBlocked({ id, missingDependencies: missing }));
      }

      // High-risk changes require explicit approval (impact-preview gate).
      if (intent.risk === "high" && !opts?.approve)
        return yield* Effect.fail(new ApprovalRequired({ id }));

      const sha = shortSha();
      yield* Effect.tryPromise(() =>
        db
          .update(intents)
          .set({ status: "applied", appliedAt: new Date(), revertedAt: null })
          .where(eq(intents.id, id)),
      ).pipe(Effect.orDie);
      yield* Effect.tryPromise(() =>
        db.insert(commits).values({
          sha,
          intentId: id,
          message: `apply: ${intent.title}`,
        }),
      ).pipe(Effect.orDie);
      yield* events.emit({
        type: "intent.applied",
        intentId: id,
        workspaceId: intent.workspaceId,
        payload: { sha, risk: intent.risk, approved: !!opts?.approve },
      });
      return yield* getRaw(id);
    });

  // ---- revert (dry_run + cascade) ----------------------------------------
  const revert = (id: string, opts?: { cascade?: boolean; dryRun?: boolean }) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      if (intent.status !== "applied")
        return yield* Effect.fail(
          new InvalidState({ id, status: intent.status, action: "revert" }),
        );

      const { edges, byId } = yield* loadWorkspace(intent.workspaceId);

      // Everything that transitively depends on `id` and is still applied would
      // break if `id` is reverted — that's the impact / required_by set.
      const impacted = G.transitiveDependents(id, edges).filter(
        (d) => byId.get(d)?.status === "applied",
      );

      // Revert order: dependents first, then the target (reverse topo).
      const planSet = [id, ...impacted];
      const order = G.topoOrder(planSet, edges).reverse();

      // Affected files across the whole plan (impact preview).
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

      // dry_run: report the plan, mutate nothing (powers impact preview UI).
      if (opts?.dryRun) return { dryRun: true as const, ...plan };

      // Safety: refuse a blind revert that would break hidden dependents.
      if (impacted.length > 0 && !opts?.cascade)
        return yield* Effect.fail(new RevertBlocked({ id, requiredBy: impacted }));

      // Execute revert in dependents-first order.
      yield* Effect.tryPromise(() =>
        db
          .update(intents)
          .set({ status: "reverted", revertedAt: new Date() })
          .where(inArray(intents.id, order)),
      ).pipe(Effect.orDie);

      for (const x of order) {
        yield* events.emit({
          type: "intent.reverted",
          intentId: x,
          workspaceId: intent.workspaceId,
          payload: { partOfCascade: order.length > 1, target: id },
        });
      }
      if (order.length > 1) {
        yield* events.emit({
          type: "revert.cascade",
          intentId: id,
          workspaceId: intent.workspaceId,
          payload: { reverted: order, count: order.length },
        });
      }

      return {
        dryRun: false as const,
        target: id,
        cascade: !!opts?.cascade,
        reverted: order.map((x) => brief(byId, x).id),
        affectedFiles,
      };
    });

  const attachCommit = (id: string, sha: string, message: string) =>
    Effect.gen(function* () {
      const intent = yield* getRaw(id);
      yield* Effect.tryPromise(() =>
        db.insert(commits).values({ sha, intentId: id, message }).onConflictDoNothing(),
      ).pipe(Effect.orDie);
      yield* events.emit({
        type: "commit.attached",
        intentId: id,
        workspaceId: intent.workspaceId,
        payload: { sha, message },
      });
    });

  return {
    create,
    addDependency,
    get,
    list,
    dependencies,
    graph,
    apply,
    revert,
    attachCommit,
  } as const;
});

export class Intents extends Effect.Tag("Intents")<
  Intents,
  Effect.Effect.Success<typeof make>
>() {
  // Bare layer: requires Db + Events; wired at the root (see runtime.ts).
  static readonly Live = Layer.effect(Intents, make);
}
