import { Effect, Layer, PubSub, Stream } from "effect";
import { desc, eq, sql } from "drizzle-orm";
import { Db } from "./Db.ts";
import { events } from "../db/schema.ts";

export interface AppEvent {
  readonly type: string;
  readonly intentId?: string;
  readonly workspaceId?: string;
  readonly payload?: Record<string, unknown>;
  readonly at?: string;
}

const make = Effect.gen(function* () {
  const { db } = yield* Db;
  // In-process fan-out for realtime subscribers (SSE). In production this is
  // where Electric SQL / a Postgres logical-replication stream would sit.
  const hub = yield* PubSub.unbounded<AppEvent>();

  /** Durably append an event AND publish it to live subscribers. */
  const emit = (e: AppEvent) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        db.insert(events).values({
          type: e.type,
          intentId: e.intentId ?? null,
          workspaceId: e.workspaceId ?? "default",
          payload: e.payload ?? {},
        }),
      ).pipe(Effect.orDie);
      yield* PubSub.publish(hub, { ...e, at: e.at ?? new Date().toISOString() });
    });

  /** Live stream of events, optionally filtered by intent or workspace/project. */
  const stream = (filter?: { intentId?: string; workspaceId?: string }) =>
    Stream.fromPubSub(hub).pipe(
      Stream.filter((e) => {
        if (filter?.intentId && e.intentId !== filter.intentId) return false;
        if (filter?.workspaceId && e.workspaceId !== filter.workspaceId) return false;
        return true;
      }),
    );

  /** Recent persisted events (observability read path). */
  const recent = (opts?: { intentId?: string; workspaceId?: string; limit?: number }) =>
    Effect.tryPromise(() => {
      let q = db.select().from(events).$dynamic();
      if (opts?.intentId) q = q.where(eq(events.intentId, opts.intentId));
      else if (opts?.workspaceId) q = q.where(eq(events.workspaceId, opts.workspaceId));
      return q.orderBy(desc(events.at)).limit(opts?.limit ?? 100);
    }).pipe(Effect.orDie);

  /** Aggregate counts by event type — the analytics / ClickHouse read shape. */
  const countsByType = () =>
    Effect.tryPromise(() =>
      db
        .select({ type: events.type, count: sql<number>`count(*)::int` })
        .from(events)
        .groupBy(events.type)
        .orderBy(desc(sql`count(*)`)),
    ).pipe(Effect.orDie);

  return { emit, stream, recent, countsByType } as const;
});

export class Events extends Effect.Tag("Events")<
  Events,
  Effect.Effect.Success<typeof make>
>() {
  // Bare layer: declares its requirement (Db) but does not self-provide it,
  // so the root composition can share a single Db instance across services.
  static readonly Live = Layer.effect(Events, make);
}
