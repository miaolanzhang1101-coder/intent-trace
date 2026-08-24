import { Effect, Layer } from "effect";
import { and, asc, desc, eq } from "drizzle-orm";
import { Db } from "./Db.ts";
import { projects, files, fileVersions } from "../db/schema.ts";
import type { Project, FileRow } from "../db/schema.ts";

let c = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(c++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface FileInput {
  readonly path: string;
  readonly content: string;
}

const make = Effect.gen(function* () {
  const { db } = yield* Db;

  const create = (name: string, testCommand?: string) =>
    Effect.gen(function* () {
      const pid = id("prj");
      yield* Effect.tryPromise(() =>
        db.insert(projects).values({ id: pid, name, testCommand: testCommand ?? "bun test" }),
      ).pipe(Effect.orDie);
      return (yield* get(pid))!;
    });

  const get = (pid: string) =>
    Effect.tryPromise(() => db.select().from(projects).where(eq(projects.id, pid)).limit(1)).pipe(
      Effect.orDie,
      Effect.map((r): Project | undefined => r[0]),
    );

  const list = () =>
    Effect.tryPromise(() => db.select().from(projects).orderBy(desc(projects.createdAt))).pipe(
      Effect.orDie,
    );

  const listFiles = (pid: string) =>
    Effect.tryPromise(() =>
      db.select().from(files).where(eq(files.projectId, pid)).orderBy(asc(files.path)),
    ).pipe(Effect.orDie);

  const readFile = (pid: string, path: string) =>
    Effect.tryPromise(() =>
      db.select().from(files).where(and(eq(files.projectId, pid), eq(files.path, path))).limit(1),
    ).pipe(
      Effect.orDie,
      Effect.map((r): FileRow | undefined => r[0]),
    );

  /** Read many files as a path->content map (used for sandbox materialization). */
  const readAll = (pid: string) =>
    listFiles(pid).pipe(
      Effect.map((rows) => new Map(rows.map((r) => [r.path, r.content] as const))),
    );

  /** Upsert a file, bumping its version and recording the prior version. */
  const writeFile = (pid: string, path: string, content: string, intentId?: string) =>
    Effect.gen(function* () {
      const existing = yield* readFile(pid, path);
      if (existing) {
        const nextVersion = existing.version + 1;
        // archive the version we're replacing
        yield* Effect.tryPromise(() =>
          db.insert(fileVersions).values({
            id: id("fv"),
            projectId: pid,
            path,
            version: existing.version,
            content: existing.content,
            intentId: intentId ?? null,
          }),
        ).pipe(Effect.orDie);
        yield* Effect.tryPromise(() =>
          db
            .update(files)
            .set({ content, version: nextVersion, updatedAt: new Date() })
            .where(eq(files.id, existing.id)),
        ).pipe(Effect.orDie);
        return nextVersion;
      }
      yield* Effect.tryPromise(() =>
        db.insert(files).values({ id: id("file"), projectId: pid, path, content, version: 1 }),
      ).pipe(Effect.orDie);
      return 1;
    });

  const deleteFile = (pid: string, path: string) =>
    Effect.tryPromise(() =>
      db.delete(files).where(and(eq(files.projectId, pid), eq(files.path, path))),
    ).pipe(Effect.orDie, Effect.asVoid);

  const putFiles = (pid: string, inputs: ReadonlyArray<FileInput>) =>
    Effect.forEach(inputs, (f) => writeFile(pid, f.path, f.content), { discard: true });

  const history = (pid: string, path: string) =>
    Effect.tryPromise(() =>
      db
        .select()
        .from(fileVersions)
        .where(and(eq(fileVersions.projectId, pid), eq(fileVersions.path, path)))
        .orderBy(desc(fileVersions.version)),
    ).pipe(Effect.orDie);

  return {
    create,
    get,
    list,
    listFiles,
    readFile,
    readAll,
    writeFile,
    deleteFile,
    putFiles,
    history,
  } as const;
});

export class Projects extends Effect.Tag("Projects")<
  Projects,
  Effect.Effect.Success<typeof make>
>() {
  static readonly Live = Layer.effect(Projects, make);
}
