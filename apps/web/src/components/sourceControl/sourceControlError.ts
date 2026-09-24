/**
 * One message for every Source Control failure, read or write.
 *
 * A failure the panel reports is not always git's. An environment whose server
 * predates the Source Control surface answers every `scm.*` request with an
 * unknown-tag defect, and a disconnected or unauthorized environment fails
 * before git is ever spawned. Blaming git for those sends the user digging
 * through their repository instead of at the environment they are looking at.
 */
import * as Cause from "effect/Cause";

const GIT_FALLBACK = "The git command failed.";

/**
 * Effect's RPC server dies with this string when it holds no handler for a
 * method, which is how a server older than this surface answers `scm.*`. It
 * arrives as a bare string rather than an error, so it never carries a
 * `message` of its own.
 */
const UNKNOWN_TAG_PREFIX = "Unknown request tag:";

/**
 * Shared with the capability gate, so an environment that never answers and
 * one that answers "unknown method" read identically to the user.
 */
export const OUTDATED_ENVIRONMENT_MESSAGE =
  "Source Control needs a newer T3 Code on this environment. Update that server, then reconnect.";

function fromText(value: string): string {
  const message = value.trim();
  if (message.length === 0) return GIT_FALLBACK;
  return message.startsWith(UNKNOWN_TAG_PREFIX) ? OUTDATED_ENVIRONMENT_MESSAGE : message;
}

/**
 * Accepts a `Cause` or an already-squashed failure, so read queries and the
 * command results the mutations return can share one message.
 */
export function sourceControlErrorMessage(cause: unknown): string {
  const failure = Cause.isCause(cause) ? Cause.squash(cause) : cause;
  if (typeof failure === "string") return fromText(failure);
  if (failure instanceof Error) return fromText(failure.message);
  return GIT_FALLBACK;
}
