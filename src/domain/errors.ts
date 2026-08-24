import { Data } from "effect";

export class IntentNotFound extends Data.TaggedError("IntentNotFound")<{
  readonly id: string;
}> {}

/** Raised when adding a dependency edge would create a cycle in the DAG. */
export class CycleDetected extends Data.TaggedError("CycleDetected")<{
  readonly from: string;
  readonly to: string;
  readonly path: ReadonlyArray<string>;
}> {}

/**
 * Raised when reverting an intent would break other applied intents that
 * (transitively) depend on it, and `cascade` was not requested. Carries the
 * blocking set so the caller can render the impact / prompt for cascade.
 */
export class RevertBlocked extends Data.TaggedError("RevertBlocked")<{
  readonly id: string;
  readonly requiredBy: ReadonlyArray<string>;
}> {}

/** Raised when applying an intent whose dependencies aren't all applied yet. */
export class ApplyBlocked extends Data.TaggedError("ApplyBlocked")<{
  readonly id: string;
  readonly missingDependencies: ReadonlyArray<string>;
}> {}

/** High-risk intents require explicit approval to apply. */
export class ApprovalRequired extends Data.TaggedError("ApprovalRequired")<{
  readonly id: string;
}> {}

export class InvalidState extends Data.TaggedError("InvalidState")<{
  readonly id: string;
  readonly status: string;
  readonly action: string;
}> {}

export class BadRequest extends Data.TaggedError("BadRequest")<{
  readonly message: string;
}> {}

export type DomainError =
  | IntentNotFound
  | CycleDetected
  | RevertBlocked
  | ApplyBlocked
  | ApprovalRequired
  | InvalidState
  | BadRequest;
