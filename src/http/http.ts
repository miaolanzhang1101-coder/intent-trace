import type { DomainError } from "../domain/errors.ts";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

export const errorResponse = (e: DomainError): Response => {
  switch (e._tag) {
    case "IntentNotFound":
      return json({ error: e._tag, id: e.id }, 404);
    case "BadRequest":
      return json({ error: e._tag, message: e.message }, 400);
    case "ApprovalRequired":
      return json({ error: e._tag, id: e.id, hint: "retry apply with approve=true" }, 428);
    case "ApplyBlocked":
      return json(
        { error: e._tag, id: e.id, missingDependencies: e.missingDependencies },
        409,
      );
    case "RevertBlocked":
      return json(
        {
          error: e._tag,
          id: e.id,
          requiredBy: e.requiredBy,
          hint: "these applied intents depend on this one; retry with cascade=true or dry_run=true to preview",
        },
        409,
      );
    case "CycleDetected":
      return json({ error: e._tag, from: e.from, to: e.to, path: e.path }, 409);
    case "InvalidState":
      return json({ error: e._tag, id: e.id, status: e.status, action: e.action }, 409);
  }
};

export const truthy = (v: string | null | undefined): boolean =>
  v === "" || v === "true" || v === "1" || v === "yes";
