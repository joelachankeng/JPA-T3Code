/**
 * Backend for the Source Control surface.
 *
 * The surface needs finer-grained git than the agent flows do — per-file
 * staging, a commit box, a graph, per-file history — so this service speaks
 * plumbing directly rather than going through GitManager's higher-level
 * actions. It runs every command through VcsProcess, which owns the spawn
 * concurrency limit, timeouts and output caps the rest of the server relies on.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  GitCommandError,
  type ScmBranchInput,
  type ScmCommit,
  type ScmCommitDetailInput,
  type ScmCommitDetailResult,
  type ScmCommitInput,
  type ScmCommitResult,
  type ScmDiffInput,
  type ScmDiffResult,
  type ScmDiffSide,
  type ScmFileEntry,
  type ScmIgnoreInput,
  type ScmLogInput,
  type ScmLogResult,
  type ScmPatchInput,
  type ScmPatchResult,
  type ScmRemoteActionInput,
  type ScmRemoteActionResult,
  type ScmShowInput,
  type ScmShowResult,
  type ScmStageInput,
  type ScmStashInput,
  type ScmStatusInput,
  type ScmStatusResult,
  type ScmTimelineEntry,
  type ScmTimelineInput,
  type ScmTimelineResult,
  type ScmViewInput,
  type ScmViewResult,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  LOG_FORMAT_ARG,
  LOG_RECORD_SEPARATOR,
  operationFromMarkers,
  parseLogRecords,
  parseNameStatusZ,
  parseNumstatZ,
  parseStatusPorcelainV2,
  remoteProvider,
  splitPerCommitBlocks,
} from "./SourceControlPanelGit.ts";

const DEFAULT_LOG_LIMIT = 100;
const DEFAULT_VIEW_LIMIT = 500;
const STATUS_NUMSTAT_FILE_CEILING = 500;
const DIFF_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CONTENTS_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** Large histories are paged; one page should never stall the panel. */
const LOG_TIMEOUT_MS = 30_000;
const REMOTE_TIMEOUT_MS = 180_000;

export class SourceControlPanelService extends Context.Service<
  SourceControlPanelService,
  {
    readonly status: (input: ScmStatusInput) => Effect.Effect<ScmStatusResult, VcsError>;
    readonly stage: (input: ScmStageInput) => Effect.Effect<void, VcsError | GitCommandError>;
    readonly commit: (
      input: ScmCommitInput,
    ) => Effect.Effect<ScmCommitResult, VcsError | GitCommandError>;
    readonly remoteAction: (
      input: ScmRemoteActionInput,
    ) => Effect.Effect<ScmRemoteActionResult, VcsError | GitCommandError>;
    readonly stash: (input: ScmStashInput) => Effect.Effect<void, VcsError | GitCommandError>;
    readonly branch: (input: ScmBranchInput) => Effect.Effect<void, VcsError | GitCommandError>;
    readonly log: (input: ScmLogInput) => Effect.Effect<ScmLogResult, VcsError>;
    readonly commitDetail: (
      input: ScmCommitDetailInput,
    ) => Effect.Effect<ScmCommitDetailResult, VcsError | GitCommandError>;
    readonly view: (input: ScmViewInput) => Effect.Effect<ScmViewResult, VcsError>;
    readonly diff: (input: ScmDiffInput) => Effect.Effect<ScmDiffResult, VcsError>;
    readonly timeline: (input: ScmTimelineInput) => Effect.Effect<ScmTimelineResult, VcsError>;
    readonly ignore: (input: ScmIgnoreInput) => Effect.Effect<void, VcsError | GitCommandError>;
    readonly patch: (input: ScmPatchInput) => Effect.Effect<ScmPatchResult, VcsError>;
    readonly show: (input: ScmShowInput) => Effect.Effect<ScmShowResult, VcsError>;
  }
>()("t3/sourceControl/SourceControlPanelService") {}

interface RunOptions {
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly stdin?: string;
}

const EMPTY_STATUS = (): ScmStatusResult => ({
  repository: {
    isRepo: false,
    root: null,
    branch: null,
    headSha: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    remotes: [],
    operation: "none",
    stashCount: 0,
  },
  merge: [],
  staged: [],
  changes: [],
  ignored: [],
  truncated: false,
});

export const make = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  /**
   * `core.quotePath=false` keeps non-ASCII paths readable instead of
   * backslash-escaped, so every parser here can treat a path as plain text.
   */
  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: RunOptions = {},
  ) =>
    vcsProcess.run({
      operation,
      command: "git",
      args: ["-C", cwd, "-c", "core.quotePath=false", ...args],
      cwd,
      spawnCwd: globalThis.process.cwd(),
      env: { LC_ALL: "C" },
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      ...(options.allowNonZeroExit !== undefined
        ? { allowNonZeroExit: options.allowNonZeroExit }
        : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
    });

  const stdout = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: RunOptions = {},
  ) => run(operation, cwd, args, options).pipe(Effect.map((result) => result.stdout));

  /** Non-zero exit tolerated, so a missing ref reads as "nothing" rather than a failure. */
  const softStdout = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: RunOptions = {},
  ) =>
    run(operation, cwd, args, { ...options, allowNonZeroExit: true }).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout : "")),
    );

  const repositoryRoot = (cwd: string) =>
    run("Scm.root", cwd, ["rev-parse", "--show-toplevel"], {
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() || null : null)));

  const gitDir = (cwd: string) =>
    run("Scm.gitDir", cwd, ["rev-parse", "--absolute-git-dir"], {
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() || null : null)));

  /**
   * Pin a pathspec to the repository root.
   *
   * Every path on this wire comes from `git status --porcelain` or `git log`,
   * both of which report from the repository root, while a bare pathspec is
   * resolved against the process's working directory. Without this, a project
   * rooted below the repository root matches nothing.
   */
  const topPath = (value: string) => `:(top)${value}`;

  const topPaths = (values: ReadonlyArray<string>) => values.map(topPath);

  /** `cwd` relative to the repository root, with a trailing slash, or "". */
  const showPrefix = (cwd: string) =>
    run("Scm.showPrefix", cwd, ["rev-parse", "--show-prefix"], {
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")));

  /**
   * Accept a path in either basis and return it relative to the repository root.
   *
   * The Source Control surface passes paths it read from git, which are already
   * root-relative. The Files surface passes paths relative to the project's own
   * directory. A path that resolves to something under `cwd` is the latter;
   * anything else is taken as already root-relative.
   */
  const resolveRepoPath = Effect.fn("Scm.resolveRepoPath")(function* (cwd: string, value: string) {
    const prefix = yield* showPrefix(cwd);
    if (prefix === "") return value;
    if (value.startsWith(prefix)) return value;
    const candidate = `${prefix}${value}`;
    const exists = yield* fileSystem
      .exists(path.join(cwd, value))
      .pipe(Effect.orElseSucceed(() => false));
    return exists ? candidate : value;
  });

  const remoteNames = (cwd: string) =>
    softStdout("Scm.remoteNames", cwd, ["remote"], { timeoutMs: 5_000 }).pipe(
      Effect.map((value) =>
        value
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
    );

  /** A command whose non-zero exit is a real failure the user must see. */
  const checked = Effect.fn("Scm.checked")(function* (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: RunOptions = {},
  ) {
    const result = yield* run(operation, cwd, args, { ...options, allowNonZeroExit: true });
    if (result.exitCode !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 4_000);
      return yield* new GitCommandError({
        operation,
        command: "git",
        cwd,
        argumentCount: args.length,
        exitCode: typeof result.exitCode === "number" ? result.exitCode : -1,
        detail: detail || `git ${args[0] ?? ""} failed.`,
      });
    }
    return result;
  });

  const operationState = Effect.fn("Scm.operationState")(function* (cwd: string) {
    const dir = yield* gitDir(cwd);
    if (!dir) return "none" as const;
    const exists = (name: string) =>
      fileSystem.exists(path.join(dir, name)).pipe(Effect.orElseSucceed(() => false));
    const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog] =
      yield* Effect.all(
        [
          exists("MERGE_HEAD"),
          exists("rebase-merge"),
          exists("rebase-apply"),
          exists("CHERRY_PICK_HEAD"),
          exists("REVERT_HEAD"),
          exists("BISECT_LOG"),
        ],
        { concurrency: 6 },
      );
    return operationFromMarkers({
      mergeHead,
      rebaseMerge,
      rebaseApply,
      cherryPickHead,
      revertHead,
      bisectLog,
    });
  });

  const stashCount = (cwd: string) =>
    softStdout("Scm.stashCount", cwd, ["stash", "list", "--format=%H"], {
      timeoutMs: 10_000,
    }).pipe(
      Effect.map((value) => value.split("\n").filter((line) => line.trim().length > 0).length),
    );

  const remoteList = Effect.fn("Scm.remoteList")(function* (cwd: string) {
    const output = yield* softStdout("Scm.remoteList", cwd, ["remote", "-v"], {
      timeoutMs: 5_000,
    });
    const byName = new Map<string, { fetchUrl: string | null; pushUrl: string | null }>();
    for (const line of output.split("\n")) {
      const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
      if (!match) continue;
      const [, name, url, direction] = match;
      if (!name || !url) continue;
      const current = byName.get(name) ?? { fetchUrl: null, pushUrl: null };
      byName.set(name, {
        fetchUrl: direction === "fetch" ? url : current.fetchUrl,
        pushUrl: direction === "push" ? url : current.pushUrl,
      });
    }
    return [...byName].map(([name, urls]) => ({ name, ...urls }));
  });

  /**
   * Fold per-file line counts onto the status entries. Skipped on very large
   * working trees, where two extra diffs would cost more than the counts are
   * worth to a list that does not lead with them.
   */
  const applyNumstat = Effect.fn("Scm.applyNumstat")(function* (
    cwd: string,
    staged: ScmFileEntry[],
    changes: ScmFileEntry[],
  ) {
    if (staged.length + changes.length > STATUS_NUMSTAT_FILE_CEILING) return;
    const [stagedOutput, unstagedOutput] = yield* Effect.all(
      [
        staged.length > 0
          ? softStdout("Scm.numstat.staged", cwd, ["diff", "--cached", "--numstat", "-z"])
          : Effect.succeed(""),
        changes.length > 0
          ? softStdout("Scm.numstat.worktree", cwd, ["diff", "--numstat", "-z"])
          : Effect.succeed(""),
      ],
      { concurrency: 2 },
    );
    const fold = (output: string, entries: ScmFileEntry[]) => {
      const counts = new Map(parseNumstatZ(output).map((change) => [change.path, change] as const));
      for (const [index, item] of entries.entries()) {
        const found = counts.get(item.path);
        if (!found) continue;
        entries[index] = {
          ...item,
          insertions: found.insertions,
          deletions: found.deletions,
        };
      }
    };
    fold(stagedOutput, staged);
    fold(unstagedOutput, changes);
  });

  const status: SourceControlPanelService["Service"]["status"] = Effect.fn("Scm.status")(
    function* (input) {
      const root = yield* repositoryRoot(input.cwd);
      if (!root) return EMPTY_STATUS();

      const args = [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
        ...(input.includeIgnored ? ["--ignored=matching"] : []),
      ];
      const result = yield* run("Scm.status", input.cwd, args, {
        allowNonZeroExit: true,
        timeoutMs: 30_000,
      });
      const parsed = parseStatusPorcelainV2(result.stdout);
      const staged = [...parsed.staged];
      const changes = [...parsed.changes];
      yield* applyNumstat(input.cwd, staged, changes);

      const [operation, stashes, remotes] = yield* Effect.all(
        [operationState(input.cwd), stashCount(input.cwd), remoteList(input.cwd)],
        { concurrency: 3 },
      );

      return {
        repository: {
          isRepo: true,
          root,
          branch: parsed.branch,
          headSha: parsed.headSha ? parsed.headSha.slice(0, 7) : null,
          detached: parsed.detached,
          unborn: parsed.unborn,
          upstream: parsed.upstream,
          ahead: parsed.ahead,
          behind: parsed.behind,
          remotes,
          operation,
          stashCount: stashes,
        },
        merge: parsed.merge,
        staged,
        changes,
        ignored: parsed.ignored,
        truncated: result.stdoutTruncated,
      } satisfies ScmStatusResult;
    },
  );

  const stage: SourceControlPanelService["Service"]["stage"] = Effect.fn("Scm.stage")(
    function* (input) {
      const paths = input.paths.filter((value) => value.trim().length > 0);
      const pathArgs = paths.length > 0 ? ["--", ...topPaths(paths)] : [];
      switch (input.action) {
        case "stage":
          yield* checked(
            "Scm.stage",
            input.cwd,
            paths.length > 0 ? ["add", "--", ...topPaths(paths)] : ["add", "-A"],
          );
          return;
        case "unstage":
          // `restore --staged` leaves the working tree alone; `reset` on an
          // unborn branch has no HEAD to reset against, so fall back there.
          yield* checked("Scm.unstage", input.cwd, ["restore", "--staged", ...pathArgs]).pipe(
            Effect.catchTag("GitCommandError", () =>
              checked("Scm.unstage.reset", input.cwd, ["reset", "-q", ...pathArgs]),
            ),
          );
          return;
        case "discard":
          yield* checked("Scm.discard", input.cwd, [
            "checkout",
            "--",
            ...(paths.length > 0 ? topPaths(paths) : [":(top)"]),
          ]);
          return;
        case "clean":
          yield* checked("Scm.clean", input.cwd, [
            "clean",
            "-fd",
            ...(paths.length > 0 ? ["--", ...topPaths(paths)] : []),
          ]);
          return;
        case "accept-ours":
        case "accept-theirs": {
          if (paths.length === 0) return;
          const side = input.action === "accept-ours" ? "--ours" : "--theirs";
          yield* checked("Scm.acceptSide", input.cwd, ["checkout", side, "--", ...topPaths(paths)]);
          yield* checked("Scm.acceptSide.add", input.cwd, ["add", "--", ...topPaths(paths)]);
          return;
        }
      }
    },
  );

  const commit: SourceControlPanelService["Service"]["commit"] = Effect.fn("Scm.commit")(
    function* (input) {
      const args = [
        "commit",
        ...(input.all ? ["--all"] : []),
        ...(input.amend ? ["--amend"] : []),
        ...(input.signoff ? ["--signoff"] : []),
        ...(input.noVerify ? ["--no-verify"] : []),
        "--file=-",
        "--cleanup=strip",
      ];
      // The message goes over stdin so a subject line starting with `#`, or any
      // shell metacharacter, survives untouched.
      yield* checked("Scm.commit", input.cwd, args, {
        stdin: input.message,
        timeoutMs: 120_000,
      });
      const described = yield* stdout("Scm.commit.describe", input.cwd, [
        "log",
        "-1",
        "--format=%H%x1f%h%x1f%s",
      ]);
      const [sha = "", shortSha = "", subject = ""] = described.trim().split("");
      return {
        sha: sha || "unknown",
        shortSha: shortSha || sha.slice(0, 7) || "unknown",
        subject: subject || input.message.split("\n")[0] || "commit",
      } satisfies ScmCommitResult;
    },
  );

  const remoteAction: SourceControlPanelService["Service"]["remoteAction"] = Effect.fn(
    "Scm.remoteAction",
  )(function* (input) {
    const remote = input.remote ?? "origin";
    const options = { timeoutMs: REMOTE_TIMEOUT_MS } satisfies RunOptions;
    const summarize = (result: { stdout: string; stderr: string }) =>
      (result.stderr.trim() || result.stdout.trim()).slice(0, 4_000);

    switch (input.action) {
      case "fetch": {
        const result = yield* checked("Scm.fetch", input.cwd, ["fetch", remote], options);
        return { action: input.action, detail: summarize(result) };
      }
      case "fetch-all": {
        const result = yield* checked("Scm.fetchAll", input.cwd, ["fetch", "--all"], options);
        return { action: input.action, detail: summarize(result) };
      }
      case "pull": {
        const result = yield* checked("Scm.pull", input.cwd, ["pull", "--ff-only"], options).pipe(
          // A diverged branch cannot fast-forward; merging is what VS Code's
          // pull does next, and it is the behaviour users expect from the button.
          Effect.catchTag("GitCommandError", () =>
            checked("Scm.pull.merge", input.cwd, ["pull", "--no-rebase"], options),
          ),
        );
        return { action: input.action, detail: summarize(result) };
      }
      case "pull-rebase": {
        const result = yield* checked("Scm.pullRebase", input.cwd, ["pull", "--rebase"], options);
        return { action: input.action, detail: summarize(result) };
      }
      case "push": {
        const result = yield* checked("Scm.push", input.cwd, ["push"], options);
        return { action: input.action, detail: summarize(result) };
      }
      case "push-force": {
        const result = yield* checked(
          "Scm.pushForce",
          input.cwd,
          ["push", "--force-with-lease"],
          options,
        );
        return { action: input.action, detail: summarize(result) };
      }
      case "publish": {
        const branch =
          input.branch ??
          (yield* stdout("Scm.publish.branch", input.cwd, [
            "rev-parse",
            "--abbrev-ref",
            "HEAD",
          ])).trim();
        const result = yield* checked(
          "Scm.publish",
          input.cwd,
          ["push", "--set-upstream", remote, branch],
          options,
        );
        return { action: input.action, detail: summarize(result) };
      }
      case "sync": {
        const pulled = yield* checked(
          "Scm.sync.pull",
          input.cwd,
          ["pull", "--ff-only"],
          options,
        ).pipe(
          Effect.catchTag("GitCommandError", () =>
            checked("Scm.sync.pullMerge", input.cwd, ["pull", "--no-rebase"], options),
          ),
        );
        const pushed = yield* checked("Scm.sync.push", input.cwd, ["push"], options);
        return {
          action: input.action,
          detail: [summarize(pulled), summarize(pushed)].filter(Boolean).join("\n"),
        };
      }
    }
  });

  const stash: SourceControlPanelService["Service"]["stash"] = Effect.fn("Scm.stash")(
    function* (input) {
      switch (input.action) {
        case "push": {
          const paths = input.paths?.filter((value) => value.trim().length > 0) ?? [];
          yield* checked("Scm.stash.push", input.cwd, [
            "stash",
            "push",
            ...(input.includeUntracked ? ["--include-untracked"] : []),
            ...(input.message ? ["--message", input.message] : []),
            ...(paths.length > 0 ? ["--", ...topPaths(paths)] : []),
          ]);
          return;
        }
        case "pop":
        case "apply":
        case "drop":
          yield* checked("Scm.stash.entry", input.cwd, [
            "stash",
            input.action,
            ...(input.ref ? [input.ref] : []),
          ]);
          return;
        case "clear":
          yield* checked("Scm.stash.clear", input.cwd, ["stash", "clear"]);
          return;
      }
    },
  );

  const branch: SourceControlPanelService["Service"]["branch"] = Effect.fn("Scm.branch")(
    function* (input) {
      switch (input.action) {
        case "checkout":
          yield* checked("Scm.branch.checkout", input.cwd, ["checkout", input.name], {
            timeoutMs: 120_000,
          });
          return;
        case "create":
          yield* checked("Scm.branch.create", input.cwd, [
            "checkout",
            "-b",
            input.name,
            ...(input.target ? [input.target] : []),
          ]);
          return;
        case "delete":
          yield* checked("Scm.branch.delete", input.cwd, ["branch", "-d", input.name]);
          return;
        case "force-delete":
          yield* checked("Scm.branch.forceDelete", input.cwd, ["branch", "-D", input.name]);
          return;
        case "rename":
          yield* checked("Scm.branch.rename", input.cwd, [
            "branch",
            "-m",
            input.name,
            input.target ?? input.name,
          ]);
          return;
        case "merge":
          yield* checked("Scm.branch.merge", input.cwd, ["merge", input.name], {
            timeoutMs: 120_000,
          });
          return;
        case "rebase":
          yield* checked("Scm.branch.rebase", input.cwd, ["rebase", input.name], {
            timeoutMs: 120_000,
          });
          return;
      }
    },
  );

  const hasWorkingTreeChanges = (cwd: string) =>
    run("Scm.dirty", cwd, ["status", "--porcelain", "-z", "--untracked-files=normal"], {
      allowNonZeroExit: true,
      timeoutMs: 15_000,
    }).pipe(Effect.map((result) => result.stdout.trim().length > 0));

  const log: SourceControlPanelService["Service"]["log"] = Effect.fn("Scm.log")(function* (input) {
    const root = yield* repositoryRoot(input.cwd);
    if (!root) {
      return { commits: [], nextSkip: null, hasWorkingTreeChanges: false } satisfies ScmLogResult;
    }
    const limit = input.limit ?? DEFAULT_LOG_LIMIT;
    const skip = input.skip ?? 0;
    const args = [
      "log",
      `--format=${LOG_FORMAT_ARG}`,
      // One extra row tells us whether another page exists without a count.
      `--max-count=${limit + 1}`,
      ...(skip > 0 ? [`--skip=${skip}`] : []),
      ...(input.all ? ["--all"] : []),
      ...(input.author ? [`--author=${input.author}`] : []),
      ...(input.search ? [`--grep=${input.search}`, "--regexp-ignore-case"] : []),
      ...(input.follow && input.path ? ["--follow"] : []),
      // A path-limited log reports each commit's real parents, which are mostly
      // commits the filter dropped, so the graph could never join them up.
      // Parent rewriting points each one at the nearest commit that is listed.
      ...(input.path ? ["--parents"] : []),
      ...(input.ref ? [input.ref] : []),
      ...(input.path ? ["--", topPath(input.path)] : []),
    ];
    const [output, remotes, dirty] = yield* Effect.all(
      [
        softStdout("Scm.log", input.cwd, args, { timeoutMs: LOG_TIMEOUT_MS }),
        remoteNames(input.cwd),
        hasWorkingTreeChanges(input.cwd),
      ],
      { concurrency: 3 },
    );
    const parsed = parseLogRecords(output, remotes);
    const commits = parsed.slice(0, limit);
    return {
      commits,
      nextSkip: parsed.length > limit ? skip + limit : null,
      hasWorkingTreeChanges: dirty,
    } satisfies ScmLogResult;
  });

  const commitDetail: SourceControlPanelService["Service"]["commitDetail"] = Effect.fn(
    "Scm.commitDetail",
  )(function* (input) {
    const remotes = yield* remoteNames(input.cwd);
    const metadata = yield* checked("Scm.commitDetail.meta", input.cwd, [
      "log",
      "-1",
      `--format=${LOG_FORMAT_ARG}`,
      input.sha,
    ]);
    const commit = parseLogRecords(metadata.stdout, remotes)[0];
    if (!commit) {
      return yield* new GitCommandError({
        operation: "Scm.commitDetail",
        command: "git",
        cwd: input.cwd,
        detail: `No commit found for ${input.sha}.`,
      });
    }
    const treeArgs = ["diff-tree", "-r", "-m", "--root", "--no-commit-id", "--find-renames"];
    const [nameStatus, numstat] = yield* Effect.all(
      [
        softStdout("Scm.commitDetail.nameStatus", input.cwd, [
          ...treeArgs,
          "--name-status",
          "-z",
          input.sha,
        ]),
        softStdout("Scm.commitDetail.numstat", input.cwd, [
          ...treeArgs,
          "--numstat",
          "-z",
          input.sha,
        ]),
      ],
      { concurrency: 2 },
    );
    const counts = new Map(parseNumstatZ(numstat).map((change) => [change.path, change] as const));
    const files = parseNameStatusZ(nameStatus).map((change) => {
      const found = counts.get(change.path);
      return {
        path: change.path,
        previousPath: change.previousPath,
        state: change.state,
        insertions: found?.insertions ?? 0,
        deletions: found?.deletions ?? 0,
      };
    });
    return {
      commit,
      files,
      insertions: files.reduce((total, file) => total + file.insertions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
    } satisfies ScmCommitDetailResult;
  });

  const branchesView = Effect.fn("Scm.view.branches")(function* (input: ScmViewInput) {
    const format = [
      "%(refname:short)",
      "%(HEAD)",
      "%(upstream:short)",
      "%(upstream:track)",
      "%(objectname)",
      "%(contents:subject)",
      "%(authorname)",
      "%(authordate:iso-strict)",
      "%(worktreepath)",
    ].join("");
    const output = yield* softStdout("Scm.view.branches", input.cwd, [
      "for-each-ref",
      `--format=${format}`,
      `--count=${input.limit ?? DEFAULT_VIEW_LIMIT}`,
      "--sort=-committerdate",
      "refs/heads",
      ...(input.includeRemote ? ["refs/remotes"] : []),
    ]);
    const [remotes, root] = yield* Effect.all([remoteNames(input.cwd), repositoryRoot(input.cwd)], {
      concurrency: 2,
    });
    const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
    const normalizedRoot = root === null ? null : normalizePath(root);
    const branches = output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const fields = line.split("");
        const name = fields[0] ?? "";
        const track = fields[3] ?? "";
        const ahead = /ahead (\d+)/.exec(track);
        const behind = /behind (\d+)/.exec(track);
        const remote = remotes.find((candidate) => name.startsWith(`${candidate}/`)) ?? null;
        return {
          name,
          current: (fields[1] ?? "").trim() === "*",
          remote,
          upstream: fields[2] ? fields[2] : null,
          ahead: ahead?.[1] ? Number.parseInt(ahead[1], 10) : 0,
          behind: behind?.[1] ? Number.parseInt(behind[1], 10) : 0,
          sha: fields[4] ?? "",
          subject: fields[5] ?? "",
          authorName: fields[6] ?? "",
          authorDate: fields[7] ?? "",
          // `%(worktreepath)` is set for the branch checked out in the main
          // worktree too; only a linked worktree is worth marking.
          worktreePath:
            fields[8] && normalizedRoot !== null && normalizePath(fields[8]) !== normalizedRoot
              ? fields[8]
              : null,
        };
      })
      .filter(
        (node) =>
          node.name.length > 0 &&
          node.sha.length > 0 &&
          // `refs/remotes/<remote>/HEAD` shortens to the bare remote name. It is
          // a symbolic pointer at the remote's default branch, not a branch of
          // its own, and listing it would duplicate that branch.
          !remotes.includes(node.name),
      );
    return { _tag: "branches" as const, branches };
  });

  const remotesView = Effect.fn("Scm.view.remotes")(function* (input: ScmViewInput) {
    const remotes = yield* remoteList(input.cwd);
    const counts = yield* softStdout("Scm.view.remotes.count", input.cwd, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/remotes",
    ]);
    const branchLines = counts.split("\n").filter((line) => line.trim().length > 0);
    return {
      _tag: "remotes" as const,
      remotes: remotes.map((remote) => ({
        name: remote.name,
        fetchUrl: remote.fetchUrl,
        pushUrl: remote.pushUrl,
        provider: remoteProvider(remote.fetchUrl ?? remote.pushUrl),
        branchCount: branchLines.filter((line) => line.startsWith(`${remote.name}/`)).length,
      })),
    };
  });

  const tagsView = Effect.fn("Scm.view.tags")(function* (input: ScmViewInput) {
    const format = [
      "%(refname:short)",
      "%(objectname)",
      "%(contents:subject)",
      "%(creatordate:iso-strict)",
      "%(objecttype)",
    ].join("");
    const output = yield* softStdout("Scm.view.tags", input.cwd, [
      "for-each-ref",
      `--format=${format}`,
      `--count=${input.limit ?? DEFAULT_VIEW_LIMIT}`,
      "--sort=-creatordate",
      "refs/tags",
    ]);
    const tags = output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const fields = line.split("");
        return {
          name: fields[0] ?? "",
          sha: fields[1] ?? "",
          subject: fields[2] ?? "",
          date: fields[3] ?? "",
          annotated: (fields[4] ?? "") === "tag",
        };
      })
      .filter((node) => node.name.length > 0 && node.sha.length > 0);
    return { _tag: "tags" as const, tags };
  });

  const stashesView = Effect.fn("Scm.view.stashes")(function* (input: ScmViewInput) {
    const output = yield* softStdout("Scm.view.stashes", input.cwd, [
      "stash",
      "list",
      "--format=%gd%H%gs%aI",
    ]);
    const rows = output.split("\n").filter((line) => line.trim().length > 0);
    const stashes = yield* Effect.forEach(
      rows,
      Effect.fn("Scm.view.stashes.entry")(function* (line, index) {
        const fields = line.split("");
        const ref = fields[0] ?? `stash@{${index}}`;
        const files = yield* softStdout("Scm.view.stashes.files", input.cwd, [
          "stash",
          "show",
          "--name-only",
          "-z",
          ref,
        ]);
        return {
          ref,
          index,
          sha: fields[1] ?? "",
          message: fields[2] ?? "",
          date: fields[3] ?? "",
          fileCount: files.split("\0").filter((value) => value.trim().length > 0).length,
        };
      }),
      { concurrency: 4 },
    );
    return { _tag: "stashes" as const, stashes: stashes.filter((node) => node.sha.length > 0) };
  });

  const worktreesView = Effect.fn("Scm.view.worktrees")(function* (input: ScmViewInput) {
    const output = yield* softStdout("Scm.view.worktrees", input.cwd, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    const root = yield* repositoryRoot(input.cwd);
    const worktrees: Array<{
      path: string;
      branch: string | null;
      sha: string;
      isMain: boolean;
      isCurrent: boolean;
      locked: boolean;
      prunable: boolean;
    }> = [];
    let current: (typeof worktrees)[number] | null = null;
    for (const line of output.split("\n")) {
      const value = line.trim();
      if (value.startsWith("worktree ")) {
        if (current) worktrees.push(current);
        current = {
          path: value.slice(9),
          branch: null,
          sha: "",
          // `worktree list` always reports the main worktree first.
          isMain: worktrees.length === 0,
          isCurrent: false,
          locked: false,
          prunable: false,
        };
        continue;
      }
      if (!current) continue;
      if (value.startsWith("HEAD ")) current.sha = value.slice(5);
      else if (value.startsWith("branch "))
        current.branch = value.slice(7).replace("refs/heads/", "");
      else if (value === "locked" || value.startsWith("locked ")) current.locked = true;
      else if (value === "prunable" || value.startsWith("prunable ")) current.prunable = true;
      else if (value === "detached") current.branch = null;
    }
    if (current) worktrees.push(current);
    const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
    return {
      _tag: "worktrees" as const,
      worktrees: worktrees.map((worktree) => ({
        ...worktree,
        isCurrent: root !== null && normalize(worktree.path) === normalize(root),
      })),
    };
  });

  const contributorsView = Effect.fn("Scm.view.contributors")(function* (input: ScmViewInput) {
    const output = yield* softStdout(
      "Scm.view.contributors",
      input.cwd,
      ["log", "--format=%an%ae%aI", `--max-count=${5_000}`],
      { timeoutMs: LOG_TIMEOUT_MS },
    );
    const byKey = new Map<string, { name: string; email: string; count: number; latest: string }>();
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [name = "", email = "", date = ""] = line.split("");
      const key = email.toLowerCase() || name.toLowerCase();
      const found = byKey.get(key);
      if (found) {
        found.count += 1;
        if (date > found.latest) found.latest = date;
        continue;
      }
      byKey.set(key, { name, email, count: 1, latest: date });
    }
    const contributors = [...byKey.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, input.limit ?? DEFAULT_VIEW_LIMIT)
      .map((entry) => ({
        name: entry.name,
        email: entry.email,
        commitCount: entry.count,
        latestDate: entry.latest,
      }));
    return { _tag: "contributors" as const, contributors };
  });

  const view: SourceControlPanelService["Service"]["view"] = (input) => {
    switch (input.view) {
      case "branches":
        return branchesView(input);
      case "remotes":
        return remotesView(input);
      case "tags":
        return tagsView(input);
      case "stashes":
        return stashesView(input);
      case "worktrees":
        return worktreesView(input);
      case "contributors":
        return contributorsView(input);
    }
  };

  /** Resolve a diff side to the revision git names it by, or null for the file on disk. */
  const revisionOf = (side: ScmDiffSide): string | null => {
    switch (side._tag) {
      case "head":
        return "HEAD";
      case "index":
        return ":";
      case "commit":
        return side.sha;
      case "commitParent":
        return `${side.sha}^`;
      case "empty":
      case "working":
        return null;
    }
  };

  const contentsAt = Effect.fn("Scm.contents")(function* (
    cwd: string,
    side: ScmDiffSide,
    filePath: string,
  ) {
    if (side._tag === "empty") return { text: "", binary: false };
    if (side._tag === "working") {
      const root = yield* repositoryRoot(cwd);
      const base = root ?? cwd;
      const absolute = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
      const text = yield* fileSystem.readFileString(absolute).pipe(Effect.orElseSucceed(() => ""));
      return { text, binary: false };
    }
    const revision = revisionOf(side);
    if (revision === null) return { text: "", binary: false };
    const spec = revision === ":" ? `:${filePath}` : `${revision}:${filePath}`;
    const result = yield* run("Scm.contents.show", cwd, ["show", spec], {
      allowNonZeroExit: true,
      maxOutputBytes: CONTENTS_MAX_OUTPUT_BYTES,
    });
    if (result.exitCode !== 0) return { text: "", binary: false };
    return { text: result.stdout, binary: result.stdoutInvalidUtf8 === true };
  });

  /**
   * Pick the git invocation that renders the requested pair. The index and the
   * working tree are not revisions, so the common cases get their own form
   * rather than being forced through `git diff <a> <b>`.
   */
  const diffArgs = (input: ScmDiffInput): string[] => {
    const base = ["diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames"];
    if (input.ignoreWhitespace) base.push("--ignore-all-space");
    // With no path the caller wants the whole change, which is how a graph row
    // opens a commit; git then needs no pathspec at all.
    const paths =
      input.path === undefined
        ? []
        : [
            "--",
            ...(input.previousPath && input.previousPath !== input.path
              ? [topPath(input.previousPath)]
              : []),
            topPath(input.path),
          ];
    const from = input.from;
    const to = input.to;

    if (to._tag === "working") {
      if (from._tag === "index") return [...base, ...paths];
      const revision = revisionOf(from);
      return [...base, ...(revision && revision !== ":" ? [revision] : []), ...paths];
    }
    if (to._tag === "index") {
      const revision = revisionOf(from);
      return [
        ...base,
        "--cached",
        ...(revision && revision !== ":" && revision !== "HEAD" ? [revision] : []),
        ...paths,
      ];
    }
    // A commit against its own parent is what a graph or timeline row asks for.
    // `git show` is used rather than `git diff <sha>^ <sha>` because the first
    // commit in a repository has no parent for `^` to name.
    if (from._tag === "commitParent" && to._tag === "commit" && from.sha === to.sha) {
      return [
        "show",
        "--format=",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--find-renames",
        ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
        to.sha,
        ...paths,
      ];
    }

    const fromRevision = revisionOf(from);
    const toRevision = revisionOf(to);
    if (from._tag === "empty" && toRevision && input.path !== undefined) {
      return [...base, "--no-index", "/dev/null", topPath(input.path)];
    }
    return [
      ...base,
      ...(fromRevision ? [fromRevision] : []),
      ...(toRevision ? [toRevision] : []),
      ...paths,
    ];
  };

  const diff: SourceControlPanelService["Service"]["diff"] = Effect.fn("Scm.diff")(
    function* (input) {
      const filePath = input.path;
      // A folder has no single file to read, and a caller that only renders
      // the patch has no use for either side's full text.
      const wantContents = filePath !== undefined && input.includeContents !== false;
      const [patchResult, oldSide, newSide] = yield* Effect.all(
        [
          run("Scm.diff", input.cwd, diffArgs(input), {
            allowNonZeroExit: true,
            maxOutputBytes: DIFF_MAX_OUTPUT_BYTES,
            timeoutMs: 30_000,
          }),
          wantContents
            ? contentsAt(input.cwd, input.from, input.previousPath ?? filePath)
            : Effect.succeed({ text: "", binary: false }),
          wantContents
            ? contentsAt(input.cwd, input.to, filePath)
            : Effect.succeed({ text: "", binary: false }),
        ],
        { concurrency: 3 },
      );
      const patch = patchResult.stdout;
      let insertions = 0;
      let deletions = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) insertions += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
      return {
        path: filePath ?? null,
        patch,
        oldContents: oldSide.text,
        newContents: newSide.text,
        binary:
          oldSide.binary ||
          newSide.binary ||
          patch.includes("Binary files ") ||
          patchResult.stdoutInvalidUtf8 === true,
        truncated: patchResult.stdoutTruncated,
        insertions,
        deletions,
      } satisfies ScmDiffResult;
    },
  );

  const timeline: SourceControlPanelService["Service"]["timeline"] = Effect.fn("Scm.timeline")(
    function* (input) {
      const root = yield* repositoryRoot(input.cwd);
      if (!root) {
        return {
          path: input.path,
          entries: [],
          nextSkip: null,
          hasUncommittedChanges: false,
          tracked: false,
        } satisfies ScmTimelineResult;
      }
      const limit = input.limit ?? DEFAULT_LOG_LIMIT;
      const skip = input.skip ?? 0;
      const paging = [`--max-count=${limit + 1}`, ...(skip > 0 ? [`--skip=${skip}`] : [])];
      const repoPath = yield* resolveRepoPath(input.cwd, input.path);
      // `--follow` needs exactly one pathspec, which is what the timeline has.
      const scope = ["--follow", "--find-renames", "--", topPath(repoPath)];

      const [metadata, nameStatus, numstat, tracked, dirty] = yield* Effect.all(
        [
          softStdout(
            "Scm.timeline.meta",
            input.cwd,
            ["log", `--format=${LOG_FORMAT_ARG}`, ...paging, ...scope],
            { timeoutMs: LOG_TIMEOUT_MS },
          ),
          softStdout(
            "Scm.timeline.nameStatus",
            input.cwd,
            [
              "log",
              `--format=${LOG_RECORD_SEPARATOR}%H`,
              "--name-status",
              "-z",
              ...paging,
              ...scope,
            ],
            { timeoutMs: LOG_TIMEOUT_MS },
          ),
          softStdout(
            "Scm.timeline.numstat",
            input.cwd,
            ["log", `--format=${LOG_RECORD_SEPARATOR}%H`, "--numstat", "-z", ...paging, ...scope],
            { timeoutMs: LOG_TIMEOUT_MS },
          ),
          run(
            "Scm.timeline.tracked",
            input.cwd,
            ["ls-files", "--error-unmatch", "--", topPath(repoPath)],
            { allowNonZeroExit: true, timeoutMs: 10_000 },
          ).pipe(Effect.map((result) => result.exitCode === 0)),
          run(
            "Scm.timeline.dirty",
            input.cwd,
            ["status", "--porcelain", "-z", "--", topPath(repoPath)],
            { allowNonZeroExit: true, timeoutMs: 10_000 },
          ).pipe(Effect.map((result) => result.stdout.trim().length > 0)),
        ],
        { concurrency: 5 },
      );

      const remotes = yield* remoteNames(input.cwd);
      const commits: ScmCommit[] = parseLogRecords(metadata, remotes);
      const statusBlocks = splitPerCommitBlocks(nameStatus);
      const numstatBlocks = splitPerCommitBlocks(numstat);

      const entries: ScmTimelineEntry[] = commits.slice(0, limit).map((commit) => {
        const changes = parseNameStatusZ(statusBlocks.get(commit.sha) ?? "");
        const counts = parseNumstatZ(numstatBlocks.get(commit.sha) ?? "");
        // A file's history has one change per commit. A folder's can have
        // several, so the row sums them and reads as a modification unless
        // every file in it changed the same way.
        const single = changes.length === 1 ? changes[0] : undefined;
        const states = new Set(changes.map((change) => change.state));
        const [onlyState] = states;
        return {
          sha: commit.sha,
          shortSha: commit.shortSha,
          subject: commit.subject,
          body: commit.body,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authorDate: commit.authorDate,
          state: states.size === 1 && onlyState !== undefined ? onlyState : "modified",
          pathAtCommit: single?.path ?? repoPath,
          insertions: counts.reduce((total, count) => total + count.insertions, 0),
          deletions: counts.reduce((total, count) => total + count.deletions, 0),
        };
      });

      return {
        // The caller gets back the path it asked about, so its surface title
        // and its tab identity stay the ones it opened.
        path: input.path,
        entries,
        nextSkip: commits.length > limit ? skip + limit : null,
        hasUncommittedChanges: dirty,
        tracked,
      } satisfies ScmTimelineResult;
    },
  );

  /**
   * Append paths to the repository's root `.gitignore`, one per line, keeping
   * the file's own line endings and skipping any line already present.
   */
  const ignore: SourceControlPanelService["Service"]["ignore"] = Effect.fn("Scm.ignore")(
    function* (input) {
      const root = yield* repositoryRoot(input.cwd);
      if (!root) {
        return yield* new GitCommandError({
          operation: "Scm.ignore",
          command: "git",
          cwd: input.cwd,
          detail: "Not a git repository.",
        });
      }
      const file = path.join(root, ".gitignore");
      const existing = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
      const eol = existing.includes("\r\n") ? "\r\n" : "\n";
      const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
      const additions = [...new Set(input.paths)].filter((value) => !present.has(value));
      if (additions.length === 0) return;
      const separator = existing.length > 0 && !existing.endsWith("\n") ? eol : "";
      yield* fileSystem
        .writeFileString(file, `${existing}${separator}${additions.join(eol)}${eol}`)
        .pipe(
          Effect.mapError(
            (cause) =>
              new GitCommandError({
                operation: "Scm.ignore",
                command: "git",
                cwd: input.cwd,
                detail: `Could not write .gitignore: ${cause.message}`,
              }),
          ),
        );
    },
  );

  /**
   * A patch for the given paths. Tracked changes come from `git diff`; an
   * untracked file is not in the index, so it is rendered against /dev/null
   * the way `git add -N` would show it, which is what VS Code copies too.
   */
  const patch: SourceControlPanelService["Service"]["patch"] = Effect.fn("Scm.patch")(
    function* (input) {
      const root = (yield* repositoryRoot(input.cwd)) ?? input.cwd;
      const prefixArgs = ["--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
      const pathspecs = topPaths(input.paths);
      if (input.staged) {
        const staged = yield* softStdout("Scm.patch.staged", root, [
          "diff",
          "--cached",
          ...prefixArgs,
          "--",
          ...pathspecs,
        ]);
        return { patch: staged } satisfies ScmPatchResult;
      }
      const [tracked, untrackedList] = yield* Effect.all(
        [
          softStdout("Scm.patch.tracked", root, ["diff", ...prefixArgs, "--", ...pathspecs]),
          softStdout("Scm.patch.untracked", root, [
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ...pathspecs,
          ]),
        ],
        { concurrency: 2 },
      );
      const untracked = untrackedList.split("\0").filter((value) => value.length > 0);
      const untrackedPatches = yield* Effect.forEach(
        untracked,
        (file) =>
          // --no-index compares two paths on disk and exits 1 when they differ,
          // which is the expected outcome here.
          run(
            "Scm.patch.untrackedFile",
            root,
            ["diff", ...prefixArgs, "--no-index", "--", "/dev/null", file],
            { allowNonZeroExit: true },
          ).pipe(Effect.map((result) => result.stdout)),
        { concurrency: 4 },
      );
      return {
        patch: [tracked, ...untrackedPatches].filter((part) => part.length > 0).join(""),
      } satisfies ScmPatchResult;
    },
  );

  /** A file's contents at a revision. `rev:path` reads from the repository root. */
  const show: SourceControlPanelService["Service"]["show"] = Effect.fn("Scm.show")(
    function* (input) {
      const ref = input.ref ?? "HEAD";
      const result = yield* run("Scm.show", input.cwd, ["show", `${ref}:${input.path}`], {
        allowNonZeroExit: true,
        maxOutputBytes: CONTENTS_MAX_OUTPUT_BYTES,
      });
      if (result.exitCode !== 0) {
        return {
          path: input.path,
          contents: "",
          exists: false,
          binary: false,
          truncated: false,
        } satisfies ScmShowResult;
      }
      return {
        path: input.path,
        contents: result.stdout,
        exists: true,
        binary: result.stdoutInvalidUtf8 === true || result.stdout.includes("\0"),
        truncated: result.stdoutTruncated,
      } satisfies ScmShowResult;
    },
  );

  return SourceControlPanelService.of({
    status,
    stage,
    commit,
    remoteAction,
    stash,
    branch,
    log,
    commitDetail,
    view,
    diff,
    timeline,
    ignore,
    patch,
    show,
  });
});

export const layer = Layer.effect(SourceControlPanelService, make);
