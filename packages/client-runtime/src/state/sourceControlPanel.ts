/**
 * Atoms backing the Source Control surface.
 *
 * Reads are query atoms so several accordions can ask for the same cwd without
 * duplicating a request; writes are commands serialized per repository, because
 * two staging operations racing on one index is how a working tree gets into a
 * state the user did not ask for.
 */
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandScheduler } from "./vcsCommandScheduler.ts";

/** One repository at a time: the index is a single shared file. */
const perRepository = {
  mode: "serial" as const,
  key: ({ environmentId, input }: { environmentId: string; input: { cwd: string } }) =>
    JSON.stringify([environmentId, input.cwd]),
};

export function createSourceControlPanelAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:status",
      tag: WS_METHODS.scmStatus,
      // The working tree changes under the user's feet while an agent runs, so
      // the panel treats a cached status as stale almost immediately and leans
      // on explicit refreshes from the VCS status stream.
      staleTimeMs: 1_000,
      idleTtlMs: 30_000,
    }),
    log: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:log",
      tag: WS_METHODS.scmLog,
      staleTimeMs: 5_000,
      idleTtlMs: 60_000,
    }),
    commitDetail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:commit-detail",
      tag: WS_METHODS.scmCommitDetail,
      // A commit is immutable, so a hit stays good for as long as it is held.
      staleTimeMs: 5 * 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    view: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:view",
      tag: WS_METHODS.scmView,
      staleTimeMs: 10_000,
      idleTtlMs: 60_000,
    }),
    diff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:diff",
      tag: WS_METHODS.scmDiff,
      staleTimeMs: 2_000,
      idleTtlMs: 60_000,
    }),
    timeline: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scm:timeline",
      tag: WS_METHODS.scmTimeline,
      staleTimeMs: 5_000,
      idleTtlMs: 5 * 60_000,
    }),
    stage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:stage",
      tag: WS_METHODS.scmStage,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    commit: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:commit",
      tag: WS_METHODS.scmCommit,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    remoteAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:remote-action",
      tag: WS_METHODS.scmRemoteAction,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    stash: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:stash",
      tag: WS_METHODS.scmStash,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    branch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:branch",
      tag: WS_METHODS.scmBranch,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    ignore: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:ignore",
      tag: WS_METHODS.scmIgnore,
      scheduler: vcsCommandScheduler,
      concurrency: perRepository,
    }),
    // A patch is read on demand, when the user asks to copy one, so it is a
    // one-shot command rather than a cached query nobody subscribes to.
    patch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scm:patch",
      tag: WS_METHODS.scmPatch,
    }),
  };
}
