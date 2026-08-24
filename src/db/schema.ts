import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * An `intent` is a high-level AI action that groups a set of related code edits
 * into a single reviewable, revertible decision — e.g. "Fix type mismatch",
 * "Update callers to new API", "Refactor SQL query".
 *
 * Git commits attach to intents (see `commits`), not the other way around.
 */
export const intents = pgTable(
  "intents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // "type-fix" | "api-migration" | "refactor" | "sql" | "feature" | ...
    kind: text("kind").notNull().default("edit"),
    // lifecycle: pending -> applied -> reverted (-> applied again on reapply)
    status: text("status").notNull().default("pending"),
    // "low" | "high" — high-risk intents require explicit approval to apply.
    risk: text("risk").notNull().default("low"),
    // Which agent/model produced this intent + its reasoning trace, persisted.
    agent: text("agent").notNull().default("unknown"),
    reasoning: text("reasoning").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
  },
  (t) => ({
    byWorkspace: index("intents_workspace_idx").on(t.workspaceId),
    byStatus: index("intents_status_idx").on(t.status),
  }),
);

/**
 * The concrete file edits that belong to an intent. This is the "grouping":
 * many edits, one reviewable decision. `diff` is a unified diff string.
 */
export const edits = pgTable(
  "edits",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    // "create" | "modify" | "delete"
    op: text("op").notNull().default("modify"),
    diff: text("diff").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byIntent: index("edits_intent_idx").on(t.intentId),
  }),
);

/**
 * Directed dependency edges forming a DAG.
 * A row (intentId, dependsOnId) means: intentId depends on dependsOnId.
 * The reverse relation is `required_by` (dependsOnId is required_by intentId).
 */
export const intentDependencies = pgTable(
  "intent_dependencies",
  {
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.intentId, t.dependsOnId] }),
    byDependsOn: index("dep_depends_on_idx").on(t.dependsOnId),
  }),
);

/** Git commits attached to an intent. Commits point at intents. */
export const commits = pgTable(
  "commits",
  {
    sha: text("sha").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    message: text("message").notNull().default(""),
    authoredAt: timestamp("authored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byIntent: index("commits_intent_idx").on(t.intentId),
  }),
);

/**
 * Append-only audit / observability log. High-throughput event data:
 * every state transition (created / applied / reverted / cascade) lands here.
 * This is the ClickHouse-shaped stream (swap the sink in Events service).
 */
export const events = pgTable(
  "events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: text("workspace_id").notNull().default("default"),
    intentId: text("intent_id"),
    // "intent.created" | "intent.applied" | "intent.reverted" | "revert.cascade" | ...
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byIntent: index("events_intent_idx").on(t.intentId),
    byType: index("events_type_idx").on(t.type),
    byAt: index("events_at_idx").on(t.at),
  }),
);

export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Edit = typeof edits.$inferSelect;
export type Dependency = typeof intentDependencies.$inferSelect;
export type Commit = typeof commits.$inferSelect;
export type EventRow = typeof events.$inferSelect;
