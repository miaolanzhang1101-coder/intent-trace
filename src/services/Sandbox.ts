import { Effect, Layer } from "effect";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { isTestFile } from "../domain/diff.ts";

export interface SandboxResult {
  readonly exitCode: number;
  readonly passed: boolean;
  readonly output: string;
  readonly durationMs: number;
  readonly skipped?: boolean;
}

/**
 * Runs a project's tests for real, in an isolated temp directory, with a
 * timeout. This is a genuine subprocess sandbox — not a security boundary.
 * In production this is where e2b / Firecracker microVMs slot in; the service
 * interface (materialize files -> run command -> return result) is unchanged.
 */
const make = Effect.succeed({
  run: (fileMap: Map<string, string>, command: string, timeoutMs = 20_000) =>
    Effect.tryPromise<SandboxResult>(async () => {
      const started = Date.now();
      const hasTests = [...fileMap.keys()].some(isTestFile);
      if (!hasTests) {
        return {
          exitCode: 0,
          passed: true,
          skipped: true,
          durationMs: Date.now() - started,
          output: "no test files found — skipping sandbox run",
        };
      }
      const dir = await mkdtemp(join(tmpdir(), "intent-sbx-"));
      try {
        for (const [path, content] of fileMap) {
          const full = join(dir, path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, content);
        }
        const proc = Bun.spawn({
          cmd: command.split(" ").filter(Boolean),
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });
        const killer = setTimeout(() => proc.kill(9), timeoutMs);
        const [out, err] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(killer);
        const output = (err + out).trim().slice(0, 20_000);
        return {
          exitCode,
          passed: exitCode === 0,
          output,
          durationMs: Date.now() - started,
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }).pipe(
      Effect.catchAll((e) =>
        Effect.succeed<SandboxResult>({
          exitCode: -1,
          passed: false,
          output: `sandbox error: ${String(e)}`,
          durationMs: 0,
        }),
      ),
    ),
});

export class Sandbox extends Effect.Tag("Sandbox")<
  Sandbox,
  Effect.Effect.Success<typeof make>
>() {
  static readonly Live = Layer.effect(Sandbox, make);
}
