/**
 * Wire types for the Source Control surface.
 *
 * The surface renders three accordions — a repository view (working tree,
 * commit box), a commit graph, and the GitLens-style grouped views — plus a
 * per-file timeline. Everything here is read or written through the
 * environment's server, so a remote workspace behaves like a local one.
 *
 * Paths are forward-slashed and relative to the repository root, the shape
 * git's own porcelain speaks, so a Windows host and a Linux host agree on the
 * wire and a project rooted below the repository root still names every file
 * the repository contains. The one exception is `ScmTimelineInput.path`, which
 * also accepts a path relative to the project directory, because the Files
 * surface names files that way.
 */
import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

const ScmPath = TrimmedNonEmptyString;

/**
 * Git's two-letter porcelain code, split. `index` is the staged side and
 * `worktree` the unstaged side, so one file can appear in both the staged and
 * the changes group with different letters, exactly as VS Code shows it.
 */
export const ScmFileState = Schema.Literals([
  "unmodified",
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "ignored",
  "conflicted",
  "type-changed",
]);
export type ScmFileState = typeof ScmFileState.Type;

export const ScmFileEntry = Schema.Struct({
  path: ScmPath,
  /** Set for renames and copies; the path the change came from. */
  previousPath: Schema.NullOr(ScmPath),
  index: ScmFileState,
  worktree: ScmFileState,
  /** True while the file is in a conflicted state and needs resolution. */
  conflicted: Schema.Boolean,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type ScmFileEntry = typeof ScmFileEntry.Type;

/** In-progress sequencer state, so the panel can offer Continue/Abort like VS Code. */
export const ScmOperationState = Schema.Literals([
  "none",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "bisect",
]);
export type ScmOperationState = typeof ScmOperationState.Type;

export const ScmRepositoryState = Schema.Struct({
  isRepo: Schema.Boolean,
  /** Repository root, absolute on the host. Null when `cwd` is not a repository. */
  root: Schema.NullOr(TrimmedNonEmptyString),
  /** Null on a detached HEAD or an unborn branch with no commits yet. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** Short sha of HEAD, null before the first commit. */
  headSha: Schema.NullOr(TrimmedNonEmptyString),
  detached: Schema.Boolean,
  /** True before the first commit, when HEAD points at an unborn branch. */
  unborn: Schema.Boolean,
  upstream: Schema.NullOr(TrimmedNonEmptyString),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  remotes: Schema.Array(
    Schema.Struct({
      name: TrimmedNonEmptyString,
      fetchUrl: Schema.NullOr(Schema.String),
      pushUrl: Schema.NullOr(Schema.String),
    }),
  ),
  operation: ScmOperationState,
  stashCount: NonNegativeInt,
});
export type ScmRepositoryState = typeof ScmRepositoryState.Type;

// RPC: status

export const ScmStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Include files matched by .gitignore. Off by default, as in VS Code. */
  includeIgnored: Schema.optional(Schema.Boolean),
});
export type ScmStatusInput = typeof ScmStatusInput.Type;

export const ScmStatusResult = Schema.Struct({
  repository: ScmRepositoryState,
  /** Conflicted paths, shown above the other groups. */
  merge: Schema.Array(ScmFileEntry),
  staged: Schema.Array(ScmFileEntry),
  /** Tracked files with unstaged edits, plus untracked files. */
  changes: Schema.Array(ScmFileEntry),
  /** Only populated when `includeIgnored` was asked for. */
  ignored: Schema.Array(ScmFileEntry),
  /** True when the listing was cut short; the panel says so rather than lying. */
  truncated: Schema.Boolean,
});
export type ScmStatusResult = typeof ScmStatusResult.Type;

// RPC: working-tree mutations

export const ScmStageAction = Schema.Literals([
  "stage",
  "unstage",
  "discard",
  /** Delete untracked files outright, which discard cannot do. */
  "clean",
  /** Resolve a conflict by taking one side, then stage the result. */
  "accept-ours",
  "accept-theirs",
]);
export type ScmStageAction = typeof ScmStageAction.Type;

export const ScmStageInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  action: ScmStageAction,
  /** Empty means "every file the action applies to", as the group headers do. */
  paths: Schema.Array(ScmPath),
});
export type ScmStageInput = typeof ScmStageInput.Type;

export const ScmCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(50_000)),
  amend: Schema.optional(Schema.Boolean),
  signoff: Schema.optional(Schema.Boolean),
  /** Stage every tracked change first, git commit -a. */
  all: Schema.optional(Schema.Boolean),
  /** Skip pre-commit and commit-msg hooks. */
  noVerify: Schema.optional(Schema.Boolean),
});
export type ScmCommitInput = typeof ScmCommitInput.Type;

export const ScmCommitResult = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
});
export type ScmCommitResult = typeof ScmCommitResult.Type;

export const ScmRemoteAction = Schema.Literals([
  "fetch",
  "fetch-all",
  "pull",
  "pull-rebase",
  "push",
  "push-force",
  /** Pull then push, what VS Code's sync button does. */
  "sync",
  /** First push of a branch with no upstream. */
  "publish",
]);
export type ScmRemoteAction = typeof ScmRemoteAction.Type;

export const ScmRemoteActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  action: ScmRemoteAction,
  remote: Schema.optional(TrimmedNonEmptyString),
  branch: Schema.optional(TrimmedNonEmptyString),
});
export type ScmRemoteActionInput = typeof ScmRemoteActionInput.Type;

export const ScmRemoteActionResult = Schema.Struct({
  action: ScmRemoteAction,
  /** Git's own summary line, surfaced verbatim in the toast. */
  detail: Schema.String,
});
export type ScmRemoteActionResult = typeof ScmRemoteActionResult.Type;

export const ScmStashAction = Schema.Literals(["push", "pop", "apply", "drop", "clear"]);
export type ScmStashAction = typeof ScmStashAction.Type;

export const ScmStashInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  action: ScmStashAction,
  message: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1_000))),
  /** Stash ref such as `stash@{2}`, required by pop, apply and drop. */
  ref: Schema.optional(TrimmedNonEmptyString),
  includeUntracked: Schema.optional(Schema.Boolean),
  /** Restrict a push to these paths, which the file context menu does. */
  paths: Schema.optional(Schema.Array(ScmPath)),
});
export type ScmStashInput = typeof ScmStashInput.Type;

// RPC: branch mutations

export const ScmBranchAction = Schema.Literals([
  "checkout",
  "create",
  "delete",
  "force-delete",
  "rename",
  "merge",
  "rebase",
]);
export type ScmBranchAction = typeof ScmBranchAction.Type;

export const ScmBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  action: ScmBranchAction,
  name: TrimmedNonEmptyString,
  /** Start point for create, or the new name for rename. */
  target: Schema.optional(TrimmedNonEmptyString),
});
export type ScmBranchInput = typeof ScmBranchInput.Type;

// RPC: log and graph

/** A ref label drawn beside a commit: the branch chips and tag chips in the graph. */
export const ScmCommitRef = Schema.Struct({
  name: TrimmedNonEmptyString,
  kind: Schema.Literals(["head", "branch", "remote", "tag", "stash"]),
});
export type ScmCommitRef = typeof ScmCommitRef.Type;

export const ScmCommit = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  parents: Schema.Array(TrimmedNonEmptyString),
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  /** ISO 8601, author date. The client formats it in the viewer's locale. */
  authorDate: Schema.String,
  committerName: Schema.String,
  committerDate: Schema.String,
  refs: Schema.Array(ScmCommitRef),
});
export type ScmCommit = typeof ScmCommit.Type;

export const ScmLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Ref or revision range. Defaults to HEAD. */
  ref: Schema.optional(TrimmedNonEmptyString),
  /** Draw every ref's history, what the graph's "All branches" filter does. */
  all: Schema.optional(Schema.Boolean),
  /** Restrict to commits touching this path, which drives file history. */
  path: Schema.optional(ScmPath),
  /** Follow the path across renames. */
  follow: Schema.optional(Schema.Boolean),
  author: Schema.optional(TrimmedNonEmptyString),
  search: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  skip: Schema.optional(NonNegativeInt),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type ScmLogInput = typeof ScmLogInput.Type;

export const ScmLogResult = Schema.Struct({
  commits: Schema.Array(ScmCommit),
  /** Null when the listing reached the end of history. */
  nextSkip: Schema.NullOr(NonNegativeInt),
  /** Uncommitted work, drawn as the graph's topmost row when present. */
  hasWorkingTreeChanges: Schema.Boolean,
});
export type ScmLogResult = typeof ScmLogResult.Type;

export const ScmCommitDetailInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
});
export type ScmCommitDetailInput = typeof ScmCommitDetailInput.Type;

export const ScmCommitDetailResult = Schema.Struct({
  commit: ScmCommit,
  files: Schema.Array(
    Schema.Struct({
      path: ScmPath,
      previousPath: Schema.NullOr(ScmPath),
      state: ScmFileState,
      insertions: NonNegativeInt,
      deletions: NonNegativeInt,
    }),
  ),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type ScmCommitDetailResult = typeof ScmCommitDetailResult.Type;

// RPC: the GitLens accordion's grouped views

export const ScmViewKind = Schema.Literals([
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "contributors",
]);
export type ScmViewKind = typeof ScmViewKind.Type;

export const ScmBranchNode = Schema.Struct({
  name: TrimmedNonEmptyString,
  current: Schema.Boolean,
  remote: Schema.NullOr(TrimmedNonEmptyString),
  upstream: Schema.NullOr(TrimmedNonEmptyString),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  sha: TrimmedNonEmptyString,
  subject: Schema.String,
  authorName: Schema.String,
  authorDate: Schema.String,
  /** Set when the branch is checked out in a linked worktree. */
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
});
export type ScmBranchNode = typeof ScmBranchNode.Type;

export const ScmRemoteNode = Schema.Struct({
  name: TrimmedNonEmptyString,
  fetchUrl: Schema.NullOr(Schema.String),
  pushUrl: Schema.NullOr(Schema.String),
  /** Provider inferred from the URL, so the row can carry the right glyph. */
  provider: Schema.NullOr(TrimmedNonEmptyString),
  branchCount: NonNegativeInt,
});
export type ScmRemoteNode = typeof ScmRemoteNode.Type;

export const ScmTagNode = Schema.Struct({
  name: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
  subject: Schema.String,
  date: Schema.String,
  annotated: Schema.Boolean,
});
export type ScmTagNode = typeof ScmTagNode.Type;

export const ScmStashNode = Schema.Struct({
  ref: TrimmedNonEmptyString,
  index: NonNegativeInt,
  message: Schema.String,
  sha: TrimmedNonEmptyString,
  date: Schema.String,
  fileCount: NonNegativeInt,
});
export type ScmStashNode = typeof ScmStashNode.Type;

export const ScmWorktreeNode = Schema.Struct({
  path: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  sha: TrimmedNonEmptyString,
  isMain: Schema.Boolean,
  isCurrent: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
});
export type ScmWorktreeNode = typeof ScmWorktreeNode.Type;

export const ScmContributorNode = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  commitCount: NonNegativeInt,
  /** Most recent commit by this author, ISO 8601. */
  latestDate: Schema.String,
});
export type ScmContributorNode = typeof ScmContributorNode.Type;

export const ScmViewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  view: ScmViewKind,
  /** Include remote-tracking branches in the branches view. */
  includeRemote: Schema.optional(Schema.Boolean),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(1_000))),
});
export type ScmViewInput = typeof ScmViewInput.Type;

export const ScmViewResult = Schema.Union([
  Schema.TaggedStruct("branches", { branches: Schema.Array(ScmBranchNode) }),
  Schema.TaggedStruct("remotes", { remotes: Schema.Array(ScmRemoteNode) }),
  Schema.TaggedStruct("tags", { tags: Schema.Array(ScmTagNode) }),
  Schema.TaggedStruct("stashes", { stashes: Schema.Array(ScmStashNode) }),
  Schema.TaggedStruct("worktrees", { worktrees: Schema.Array(ScmWorktreeNode) }),
  Schema.TaggedStruct("contributors", { contributors: Schema.Array(ScmContributorNode) }),
]);
export type ScmViewResult = typeof ScmViewResult.Type;

// RPC: diffs for a single file at a revision

/**
 * Which two sides to diff. `working` is the file on disk, `index` its staged
 * copy, `head` its committed copy. A `commit` side names an explicit revision,
 * which is how a timeline row and a graph row open their change.
 */
export const ScmDiffSide = Schema.Union([
  Schema.TaggedStruct("working", {}),
  Schema.TaggedStruct("index", {}),
  Schema.TaggedStruct("head", {}),
  Schema.TaggedStruct("commit", { sha: TrimmedNonEmptyString }),
  /** The first parent of a commit, so a row can diff against "before". */
  Schema.TaggedStruct("commitParent", { sha: TrimmedNonEmptyString }),
  Schema.TaggedStruct("empty", {}),
]);
export type ScmDiffSide = typeof ScmDiffSide.Type;

export const ScmDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Absent diffs every file the two sides differ in, which is how a graph row opens a commit. */
  path: Schema.optional(ScmPath),
  previousPath: Schema.optional(Schema.NullOr(ScmPath)),
  from: ScmDiffSide,
  to: ScmDiffSide,
  ignoreWhitespace: Schema.optional(Schema.Boolean),
  /**
   * Whole-file contents for both sides. Off for a folder, which has no single
   * file to read, and for any caller that only renders the patch.
   */
  includeContents: Schema.optional(Schema.Boolean),
});
export type ScmDiffInput = typeof ScmDiffInput.Type;

export const ScmDiffResult = Schema.Struct({
  path: Schema.NullOr(ScmPath),
  /** Unified patch, already prefixed a/ and b/ so the existing renderer reads it. */
  patch: Schema.String,
  /** Whole-file contents for the side-by-side renderer. Empty for a whole-commit diff. */
  oldContents: Schema.String,
  newContents: Schema.String,
  /** True when either side is not valid UTF-8; the panel shows a binary notice. */
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type ScmDiffResult = typeof ScmDiffResult.Type;

// RPC: folder and file actions from the context menu

export const ScmIgnoreInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /**
   * Written one per line to the repository's root `.gitignore`. A folder is
   * added as the files under it, which is what VS Code writes.
   */
  paths: Schema.Array(ScmPath),
});
export type ScmIgnoreInput = typeof ScmIgnoreInput.Type;

export const ScmPatchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  paths: Schema.Array(ScmPath),
  /** The index against HEAD when true, else the working tree against the index. */
  staged: Schema.Boolean,
});
export type ScmPatchInput = typeof ScmPatchInput.Type;

export const ScmPatchResult = Schema.Struct({
  /**
   * A patch `git apply` accepts. Untracked files are included as new files,
   * which a plain `git diff` would leave out.
   */
  patch: Schema.String,
});
export type ScmPatchResult = typeof ScmPatchResult.Type;

// RPC: a file as it was at a revision, for "Open File (HEAD)"

export const ScmShowInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: ScmPath,
  /** Any revision git accepts. Defaults to HEAD. */
  ref: Schema.optional(TrimmedNonEmptyString),
});
export type ScmShowInput = typeof ScmShowInput.Type;

export const ScmShowResult = Schema.Struct({
  path: ScmPath,
  contents: Schema.String,
  /** False when the file does not exist at that revision, such as a new file. */
  exists: Schema.Boolean,
  /** True when the contents are not valid UTF-8; the panel shows a notice instead. */
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type ScmShowResult = typeof ScmShowResult.Type;

// RPC: file timeline

export const ScmTimelineInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: ScmPath,
  skip: Schema.optional(NonNegativeInt),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type ScmTimelineInput = typeof ScmTimelineInput.Type;

export const ScmTimelineEntry = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  authorDate: Schema.String,
  /** What the commit did to this file. */
  state: ScmFileState,
  /** The file's path in that commit, which differs from `path` across a rename. */
  pathAtCommit: ScmPath,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type ScmTimelineEntry = typeof ScmTimelineEntry.Type;

export const ScmTimelineResult = Schema.Struct({
  path: ScmPath,
  entries: Schema.Array(ScmTimelineEntry),
  nextSkip: Schema.NullOr(NonNegativeInt),
  /** True when the file has uncommitted edits, drawn as the newest row. */
  hasUncommittedChanges: Schema.Boolean,
  /** False when the path is untracked or outside a repository. */
  tracked: Schema.Boolean,
});
export type ScmTimelineResult = typeof ScmTimelineResult.Type;

export const SourceControlPanelError = Schema.Union([VcsError, GitCommandError]);
export type SourceControlPanelError = typeof SourceControlPanelError.Type;
