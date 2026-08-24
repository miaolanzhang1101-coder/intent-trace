import type { PGlite } from "@electric-sql/pglite";

/**
 * DDL is applied at startup and is idempotent (CREATE ... IF NOT EXISTS).
 * In a hosted-Postgres deployment you'd instead run `drizzle-kit generate`
 * and ship versioned SQL migrations; the schema in `schema.ts` is the source
 * of truth for both the typed query layer and this DDL.
 */
export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS intents (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'edit',
  status        TEXT NOT NULL DEFAULT 'proposed',
  risk          TEXT NOT NULL DEFAULT 'low',
  project_id    TEXT,
  affected      JSONB NOT NULL DEFAULT '{}',
  agent         TEXT NOT NULL DEFAULT 'unknown',
  reasoning     TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,
  reverted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS intents_workspace_idx ON intents (workspace_id);
CREATE INDEX IF NOT EXISTS intents_status_idx    ON intents (status);

CREATE TABLE IF NOT EXISTS edits (
  id         TEXT PRIMARY KEY,
  intent_id  TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  op         TEXT NOT NULL DEFAULT 'modify',
  diff       TEXT NOT NULL DEFAULT '',
  new_content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edits_intent_idx ON edits (intent_id);

CREATE TABLE IF NOT EXISTS intent_dependencies (
  intent_id     TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intent_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS dep_depends_on_idx ON intent_dependencies (depends_on_id);

CREATE TABLE IF NOT EXISTS commits (
  sha         TEXT PRIMARY KEY,
  intent_id   TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  message     TEXT NOT NULL DEFAULT '',
  authored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commits_intent_idx ON commits (intent_id);

CREATE TABLE IF NOT EXISTS events (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  intent_id    TEXT,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_intent_idx ON events (intent_id);
CREATE INDEX IF NOT EXISTS events_type_idx   ON events (type);
CREATE INDEX IF NOT EXISTS events_at_idx      ON events (at);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  test_command TEXT NOT NULL DEFAULT 'bun test',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  version    INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_uidx ON files (project_id, path);

CREATE TABLE IF NOT EXISTS file_versions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  version    INT NOT NULL,
  content    TEXT NOT NULL,
  intent_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fv_path_idx ON file_versions (project_id, path);

CREATE TABLE IF NOT EXISTS snapshots (
  id           TEXT PRIMARY KEY,
  intent_id    TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  prev_existed TEXT NOT NULL DEFAULT 'true',
  prev_content TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snap_intent_idx ON snapshots (intent_id);

CREATE TABLE IF NOT EXISTS executions (
  id          TEXT PRIMARY KEY,
  intent_id   TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  command     TEXT NOT NULL DEFAULT '',
  exit_code   INT,
  passed      TEXT NOT NULL DEFAULT 'false',
  output      TEXT NOT NULL DEFAULT '',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS exec_intent_idx ON executions (intent_id);
`;

export async function applyMigrations(pg: PGlite): Promise<void> {
  await pg.exec(DDL);
}
