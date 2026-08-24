/** Minimal but correct line-based unified diff (LCS DP). Files are small. */
export function unifiedDiff(oldStr: string, newStr: string, path = "file"): string {
  const a = oldStr === "" ? [] : oldStr.split("\n");
  const b = newStr === "" ? [] : newStr.split("\n");
  const n = a.length;
  const m = b.length;
  // LCS length table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);

  type Op = { tag: " " | "-" | "+"; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ tag: "-", line: a[i]! });
      i++;
    } else {
      ops.push({ tag: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "-", line: a[i++]! });
  while (j < m) ops.push({ tag: "+", line: b[j++]! });

  const changed = ops.some((o) => o.tag !== " ");
  if (!changed) return "";
  const header = `--- a/${path}\n+++ b/${path}`;
  const bodyLines = ops.map((o) => `${o.tag}${o.line}`);
  return [header, ...bodyLines].join("\n");
}

/** Group changed files into a top-level "module" for impact analysis. */
export function moduleOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "root";
  // src/api/UserController.ts -> "api"; packages/x/... -> "x"
  if (parts[0] === "src" && parts[1]) return parts[1]!;
  return parts[0]!;
}

export function isTestFile(path: string): boolean {
  return /(\.test\.|\.spec\.|(^|\/)tests?\/)/.test(path);
}
