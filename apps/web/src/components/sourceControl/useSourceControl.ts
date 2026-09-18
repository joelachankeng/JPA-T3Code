/**
 * Query and command hooks for the Source Control surface.
 *
 * Every hook is keyed by `{environmentId, cwd}` so the three accordions and the
 * timeline share one request per query, and so a remote workspace behaves the
 * same as a local one.
 */
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ScmCommitDetailResult,
  ScmDiffInput,
  ScmDiffResult,
  ScmLogInput,
  ScmLogResult,
  ScmStatusResult,
  ScmTimelineResult,
  ScmViewInput,
  ScmViewResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { sourceControlPanel } from "~/state/sourceControlPanel";

export interface ScmQueryState<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function describe(result: AsyncResult.AsyncResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  if (cause instanceof Error) return cause.message;
  return "The git command failed.";
}

function useScmQuery<A>(atom: Parameters<typeof useAtomValue>[0]): ScmQueryState<A> {
  const result = useAtomValue(atom) as AsyncResult.AsyncResult<A, unknown>;
  const refreshAtom = useAtomRefresh(atom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  return {
    data: Option.getOrNull(AsyncResult.value(result)) as A | null,
    error: describe(result),
    isPending: result.waiting,
    refresh,
  };
}

export interface ScmTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export function useScmStatus(target: ScmTarget): ScmQueryState<ScmStatusResult> {
  return useScmQuery<ScmStatusResult>(
    sourceControlPanel.status({ environmentId: target.environmentId, input: { cwd: target.cwd } }),
  );
}

export function useScmLog(
  target: ScmTarget,
  input: Omit<ScmLogInput, "cwd">,
): ScmQueryState<ScmLogResult> {
  return useScmQuery<ScmLogResult>(
    sourceControlPanel.log({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, ...input },
    }),
  );
}

export function useScmView(
  target: ScmTarget,
  input: Omit<ScmViewInput, "cwd">,
): ScmQueryState<ScmViewResult> {
  return useScmQuery<ScmViewResult>(
    sourceControlPanel.view({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, ...input },
    }),
  );
}

export function useScmCommitDetail(
  target: ScmTarget,
  sha: string | null,
): ScmQueryState<ScmCommitDetailResult> {
  // An empty sha would still be a valid atom key, so the caller's "nothing
  // selected" state is expressed by never subscribing to a real request.
  return useScmQuery<ScmCommitDetailResult>(
    sourceControlPanel.commitDetail({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, sha: sha ?? "HEAD" },
    }),
  );
}

export function useScmTimeline(
  target: ScmTarget,
  path: string,
  limit?: number,
): ScmQueryState<ScmTimelineResult> {
  return useScmQuery<ScmTimelineResult>(
    sourceControlPanel.timeline({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, path, ...(limit === undefined ? {} : { limit }) },
    }),
  );
}

export function useScmDiff(
  target: ScmTarget,
  input: Omit<ScmDiffInput, "cwd"> | null,
): ScmQueryState<ScmDiffResult> {
  // A null request still needs a stable atom key, so it resolves to a cheap
  // no-op diff whose result the caller discards below.
  const resolved: Omit<ScmDiffInput, "cwd"> = input ?? {
    from: { _tag: "head" },
    to: { _tag: "head" },
  };
  const state = useScmQuery<ScmDiffResult>(
    sourceControlPanel.diff({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, ...resolved },
    }),
  );
  if (input === null) return { data: null, error: null, isPending: false, refresh: state.refresh };
  return state;
}

/** Mutations. Each resolves to a result the caller can branch on for a toast. */
export function useScmCommands() {
  return {
    stage: useAtomCommand(sourceControlPanel.stage, { reportFailure: false }),
    commit: useAtomCommand(sourceControlPanel.commit, { reportFailure: false }),
    remoteAction: useAtomCommand(sourceControlPanel.remoteAction, { reportFailure: false }),
    stash: useAtomCommand(sourceControlPanel.stash, { reportFailure: false }),
    branch: useAtomCommand(sourceControlPanel.branch, { reportFailure: false }),
  };
}

/** Message for a failed command, matching how the panel reports git's own words. */
export function commandErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return "The git command failed.";
}
