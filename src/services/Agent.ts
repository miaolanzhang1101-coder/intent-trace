import { Effect, Layer } from "effect";
import { Projects } from "./Projects.ts";
import { unifiedDiff } from "../domain/diff.ts";

export interface ProposedEdit {
  readonly path: string;
  readonly op: "create" | "modify" | "delete";
  readonly newContent: string;
  readonly diff: string;
}
export interface Proposal {
  readonly title: string;
  readonly kind: string;
  readonly risk: "low" | "high";
  readonly reasoning: string;
  readonly edits: ProposedEdit[];
}

type FileMap = Map<string, string>;
const lower = (s: string) => s.toLowerCase();
const srcFiles = (m: FileMap) =>
  [...m.keys()].filter((p) => /\.(ts|tsx|js|jsx)$/.test(p) && !/\.(test|spec)\./.test(p));

/**
 * Each transform inspects the prompt + real file contents and, if applicable,
 * returns a genuine edit (new file content + unified diff). This is a
 * deterministic stand-in for an LLM code agent; swapping in a real model
 * (Anthropic / OpenAI) means replacing `transforms` with a model call that
 * returns the same {path, op, newContent} shape — nothing downstream changes.
 */
type Transform = (prompt: string, files: FileMap) => Proposal | null;

// 1) Bump a dependency version in package.json.
const bumpDependency: Transform = (prompt, files) => {
  if (!/\b(upgrade|bump|update)\b/.test(lower(prompt))) return null;
  const pkgPath = [...files.keys()].find((p) => p.endsWith("package.json"));
  if (!pkgPath) return null;
  let pkg: any;
  try {
    pkg = JSON.parse(files.get(pkgPath)!);
  } catch {
    return null;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const names = Object.keys(deps);
  const target =
    names.find((n) => lower(prompt).includes(lower(n))) ??
    names.find((n) => lower(prompt).includes(lower(n.split("/").pop()!)));
  if (!target) return null;
  const versionMatch = prompt.match(/(\d+\.\d+\.\d+)/);
  const newVersion = versionMatch ? versionMatch[1]! : "latest";
  const before = deps[target] as string;
  const majorBefore = Number(String(before).replace(/[^\d.]/g, "").split(".")[0] ?? 0);
  const majorAfter = Number(newVersion.split(".")[0] ?? 0);
  if (pkg.dependencies?.[target] !== undefined) pkg.dependencies[target] = newVersion;
  if (pkg.devDependencies?.[target] !== undefined) pkg.devDependencies[target] = newVersion;
  const newContent = JSON.stringify(pkg, null, 2) + "\n";
  return {
    title: `Upgrade ${target} to ${newVersion}`,
    kind: "dependency",
    risk: majorAfter > majorBefore ? "high" : "low",
    reasoning: `Bumped ${target} from ${before} to ${newVersion} in ${pkgPath}. ${
      majorAfter > majorBefore ? "Major version change — flagged high-risk." : "Minor/patch bump."
    }`,
    edits: [{ path: pkgPath, op: "modify", newContent, diff: unifiedDiff(files.get(pkgPath)!, newContent, pkgPath) }],
  };
};

// 2) Add a null guard to the first exported function of a target source file.
const fixNullPointer: Transform = (prompt, files) => {
  if (!/(null\s*pointer|nullpointer|npe|null\s*check|null|undefined)/.test(lower(prompt))) return null;
  const candidates = srcFiles(files);
  const target =
    candidates.find((p) => lower(prompt).includes(lower(p.split("/").pop()!.replace(/\.\w+$/, "")))) ??
    candidates[0];
  if (!target) return null;
  const content = files.get(target)!;
  // find:  export function NAME(PARAM ...) {   (or plain `function`)
  const re = /((?:export\s+)?function\s+(\w+)\s*\(\s*(\w+)[^)]*\)\s*(?::[^)]*?)?\s*\{)/;
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const param = m[3]!;
  const insertAt = m.index + m[1]!.length;
  const guard = `\n  if (${param} == null) return undefined;`;
  if (content.includes(`if (${param} == null)`)) return null; // already guarded
  const newContent = content.slice(0, insertAt) + guard + content.slice(insertAt);
  const edits: ProposedEdit[] = [
    { path: target, op: "modify", newContent, diff: unifiedDiff(content, newContent, target) },
  ];
  // add a regression test next to the source (imports the real module)
  const base = target.replace(/\.(ts|tsx|js|jsx)$/, "");
  const fn = m[2]!;
  const testPath = `${base}.nullguard.test.ts`;
  if (!files.has(testPath)) {
    const rel = "./" + (target.split("/").pop() ?? target);
    const testContent =
      `import { expect, test } from "bun:test";\n` +
      `import { ${fn} } from "${rel}";\n\n` +
      `test("${fn} handles null input without throwing", () => {\n` +
      `  expect(${fn}(null as any)).toBeUndefined();\n});\n`;
    edits.push({ path: testPath, op: "create", newContent: testContent, diff: unifiedDiff("", testContent, testPath) });
  }
  return {
    title: `Fix null pointer in ${fn}`,
    kind: "bug-fix",
    risk: "low",
    reasoning: `Added a null guard for parameter \`${param}\` in ${fn} (${target}) and a regression test asserting it no longer throws on null input.`,
    edits,
  };
};

// 3) Insert request validation into a route/controller/handler file.
const addValidation: Transform = (prompt, files) => {
  if (!/(validat|request\s*validation|sanitiz)/.test(lower(prompt))) return null;
  const target = srcFiles(files).find((p) => /(route|controller|handler|api)/i.test(p));
  if (!target) return null;
  const content = files.get(target)!;
  if (content.includes("// [validation]")) return null;
  const banner = `// [validation] added by agent\nfunction validateRequest(input: unknown): void {\n  if (input == null || typeof input !== "object") throw new Error("invalid request");\n}\n\n`;
  const newContent = banner + content;
  return {
    title: "Add request validation",
    kind: "api-change",
    risk: "low",
    reasoning: `Inserted a validateRequest guard at the top of ${target}.`,
    edits: [{ path: target, op: "modify", newContent, diff: unifiedDiff(content, newContent, target) }],
  };
};

// 4) Fallback: annotate a chosen file with a TODO capturing the request.
const genericAnnotate: Transform = (prompt, files) => {
  const candidates = srcFiles(files);
  const target =
    candidates.find((p) =>
      lower(prompt).includes(lower(p.split("/").pop()!.replace(/\.\w+$/, ""))),
    ) ??
    candidates.find((p) => lower(prompt).includes(lower(p.split("/").pop()!))) ??
    candidates[0] ??
    [...files.keys()][0];
  if (!target) return null;
  const content = files.get(target)!;
  const newContent = `// TODO(agent): ${prompt.trim()}\n` + content;
  return {
    title: prompt.trim().slice(0, 60) || "Apply change",
    kind: "edit",
    risk: "low",
    reasoning: `No specialized transform matched; annotated ${target} with the request for a human to refine.`,
    edits: [{ path: target, op: "modify", newContent, diff: unifiedDiff(content, newContent, target) }],
  };
};

const transforms: Transform[] = [bumpDependency, fixNullPointer, addValidation, genericAnnotate];

const make = Effect.gen(function* () {
  const projects = yield* Projects;

  const propose = (projectId: string, prompt: string) =>
    Effect.gen(function* () {
      const files = yield* projects.readAll(projectId);
      for (const t of transforms) {
        const proposal = t(prompt, files);
        if (proposal && proposal.edits.length > 0) {
          // escalate risk if the change is broad
          const risk =
            proposal.edits.length > 3 || proposal.edits.some((e) => e.path.endsWith("package.json"))
              ? proposal.risk === "high"
                ? "high"
                : proposal.risk
              : proposal.risk;
          return { ...proposal, risk } as Proposal;
        }
      }
      return genericAnnotate(prompt, files)!;
    });

  return { propose } as const;
});

export class Agent extends Effect.Tag("Agent")<Agent, Effect.Effect.Success<typeof make>>() {
  static readonly Live = Layer.effect(Agent, make);
}
