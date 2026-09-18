/**
 * Parsers for the git plumbing the Source Control surface reads.
 *
 * These are pure so the shapes the panel depends on — porcelain v2 records,
 * `%x1e`-delimited log records, NUL-separated name-status and numstat blocks —
 * are testable without spawning git. Everything that touches a process lives in
 * SourceControlPanelService.
 */
import type {
  ScmCommit,
  ScmCommitRef,
  ScmFileEntry,
  ScmFileState,
  ScmOperationState,
} from "@t3tools/contracts";

/** Record and field separators used in our `git log --format` strings. */
export const LOG_RECORD_SEPARATOR = "";
export const LOG_FIELD_SEPARATOR = "";

/**
 * Fields in the order `parseLogRecords` expects. `%b` stays last because a
 * body is the only field that can contain newlines.
 */
export const LOG_FORMAT = [
  "%H",
  "%h",
  "%P",
  "%an",
  "%ae",
  "%aI",
  "%cn",
  "%cI",
  "%D",
  "%s",
  "%b",
].join(LOG_FIELD_SEPARATOR);

export const LOG_FORMAT_ARG = `${LOG_RECORD_SEPARATOR}${LOG_FORMAT}`;

function fileState(code: string): ScmFileState {
  switch (code) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "conflicted";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    default:
      return "unmodified";
  }
}

/** `git diff --name-status` prefixes renames and copies with a similarity score. */
export function nameStatusState(code: string): ScmFileState {
  return fileState(code.charAt(0).toUpperCase());
}

export interface ParsedStatus {
  readonly branch: string | null;
  readonly headSha: string | null;
  readonly detached: boolean;
  readonly unborn: boolean;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly merge: ScmFileEntry[];
  readonly staged: ScmFileEntry[];
  readonly changes: ScmFileEntry[];
  readonly ignored: ScmFileEntry[];
}

function entry(
  path: string,
  previousPath: string | null,
  index: ScmFileState,
  worktree: ScmFileState,
  conflicted: boolean,
): ScmFileEntry {
  return { path, previousPath, index, worktree, conflicted, insertions: 0, deletions: 0 };
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * A record's fields are space-separated, but a rename's original path arrives
 * as its own NUL-separated field after the record, so the reader consumes
 * fields rather than iterating lines.
 */
export function parseStatusPorcelainV2(output: string): ParsedStatus {
  const records = output.split("\0");
  let branch: string | null = null;
  let headSha: string | null = null;
  let detached = false;
  let unborn = false;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const merge: ScmFileEntry[] = [];
  const staged: ScmFileEntry[] = [];
  const changes: ScmFileEntry[] = [];
  const ignored: ScmFileEntry[] = [];

  for (let cursor = 0; cursor < records.length; cursor += 1) {
    const record = records[cursor];
    if (record === undefined || record.length === 0) continue;

    if (record.startsWith("# ")) {
      const [key, ...rest] = record.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") {
        if (value === "(initial)") unborn = true;
        else headSha = value;
      } else if (key === "branch.head") {
        if (value === "(detached)") detached = true;
        else branch = value;
      } else if (key === "branch.upstream") {
        upstream = value;
      } else if (key === "branch.ab") {
        for (const part of value.split(" ")) {
          if (part.startsWith("+")) ahead = Number.parseInt(part.slice(1), 10) || 0;
          else if (part.startsWith("-")) behind = Number.parseInt(part.slice(1), 10) || 0;
        }
      }
      continue;
    }

    const kind = record.charAt(0);

    if (kind === "?") {
      const path = record.slice(2);
      if (path) changes.push(entry(path, null, "unmodified", "untracked", false));
      continue;
    }

    if (kind === "!") {
      const path = record.slice(2);
      if (path) ignored.push(entry(path, null, "unmodified", "ignored", false));
      continue;
    }

    if (kind === "u") {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const fields = record.split(" ");
      const path = fields.slice(10).join(" ");
      if (path) merge.push(entry(path, null, "conflicted", "conflicted", true));
      continue;
    }

    if (kind !== "1" && kind !== "2") continue;

    const fields = record.split(" ");
    const xy = fields[1] ?? "..";
    const indexState = fileState(xy.charAt(0));
    const worktreeState = fileState(xy.charAt(1));

    let path: string;
    let previousPath: string | null = null;
    if (kind === "2") {
      // 1 .. 8 are the shared fields, 9 is <X><score>, the rest is the path.
      path = fields.slice(9).join(" ");
      // The original path is the next NUL-separated field.
      cursor += 1;
      previousPath = records[cursor] ?? null;
    } else {
      path = fields.slice(8).join(" ");
    }
    if (!path) continue;

    if (indexState !== "unmodified") {
      staged.push(entry(path, previousPath, indexState, "unmodified", false));
    }
    if (worktreeState !== "unmodified") {
      // The unstaged side of a renamed file is an edit to the new path, not a
      // second rename, so the previous path stays on the staged row only.
      changes.push(entry(path, null, "unmodified", worktreeState, false));
    }
  }

  return {
    branch,
    headSha,
    detached,
    unborn,
    upstream,
    ahead,
    behind,
    merge,
    staged,
    changes,
    ignored,
  };
}

/** Classify `%D` decorations into the chips drawn beside a graph row. */
export function parseCommitRefs(
  decorations: string,
  remoteNames: ReadonlyArray<string>,
): ScmCommitRef[] {
  const refs: ScmCommitRef[] = [];
  for (const raw of decorations.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (name.startsWith("tag: ")) {
      refs.push({ name: name.slice(5), kind: "tag" });
      continue;
    }
    if (name.startsWith("HEAD -> ")) {
      const target = name.slice(8);
      refs.push({ name: target, kind: "head" });
      continue;
    }
    if (name === "HEAD") {
      refs.push({ name: "HEAD", kind: "head" });
      continue;
    }
    if (name.startsWith("refs/stash") || name === "stash") {
      refs.push({ name: "stash", kind: "stash" });
      continue;
    }
    const remote = remoteNames.find((candidate) => name.startsWith(`${candidate}/`));
    refs.push({ name, kind: remote ? "remote" : "branch" });
  }
  return refs;
}

/** Parse the `%x1e`-delimited stream produced by LOG_FORMAT. */
export function parseLogRecords(output: string, remoteNames: ReadonlyArray<string>): ScmCommit[] {
  const commits: ScmCommit[] = [];
  for (const chunk of output.split(LOG_RECORD_SEPARATOR)) {
    if (!chunk.trim()) continue;
    const fields = chunk.split(LOG_FIELD_SEPARATOR);
    const sha = fields[0]?.trim();
    if (!sha) continue;
    commits.push({
      sha,
      shortSha: fields[1]?.trim() ?? sha.slice(0, 7),
      parents: (fields[2] ?? "").split(" ").filter((value) => value.length > 0),
      authorName: fields[3] ?? "",
      authorEmail: fields[4] ?? "",
      authorDate: fields[5] ?? "",
      committerName: fields[6] ?? "",
      committerDate: fields[7] ?? "",
      refs: parseCommitRefs(fields[8] ?? "", remoteNames),
      subject: fields[9] ?? "",
      // Trailing newline comes from the record separator, not the body.
      body: (fields[10] ?? "").replace(/\n+$/, ""),
    });
  }
  return commits;
}

export interface NameStatusChange {
  readonly state: ScmFileState;
  readonly path: string;
  readonly previousPath: string | null;
}

/**
 * Parse `git diff --name-status -z`: a status field, then one path, or two for
 * a rename or copy.
 */
export function parseNameStatusZ(output: string): NameStatusChange[] {
  const fields = output.split("\0");
  const changes: NameStatusChange[] = [];
  for (let cursor = 0; cursor < fields.length; cursor += 1) {
    const code = fields[cursor];
    if (!code) continue;
    const letter = code.charAt(0).toUpperCase();
    if (letter === "R" || letter === "C") {
      const previousPath = fields[cursor + 1];
      const path = fields[cursor + 2];
      cursor += 2;
      if (path)
        changes.push({ state: nameStatusState(code), path, previousPath: previousPath ?? null });
      continue;
    }
    const path = fields[cursor + 1];
    cursor += 1;
    if (path) changes.push({ state: nameStatusState(code), path, previousPath: null });
  }
  return changes;
}

export interface NumstatChange {
  readonly insertions: number;
  readonly deletions: number;
  readonly path: string;
  readonly previousPath: string | null;
}

function parseCount(value: string | undefined): number {
  // Git writes "-" for binary files.
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse `git diff --numstat -z`. Each record is `adds\tdels\tpath`, except a
 * rename, which ends the record after the tabs and follows it with the old and
 * new paths as their own NUL-separated fields.
 */
export function parseNumstatZ(output: string): NumstatChange[] {
  const fields = output.split("\0");
  const changes: NumstatChange[] = [];
  for (let cursor = 0; cursor < fields.length; cursor += 1) {
    const record = fields[cursor];
    if (!record) continue;
    const parts = record.split("\t");
    if (parts.length < 3) continue;
    const insertions = parseCount(parts[0]);
    const deletions = parseCount(parts[1]);
    if (parts[2] === "") {
      const previousPath = fields[cursor + 1];
      const path = fields[cursor + 2];
      cursor += 2;
      if (path) changes.push({ insertions, deletions, path, previousPath: previousPath ?? null });
      continue;
    }
    changes.push({ insertions, deletions, path: parts[2] ?? "", previousPath: null });
  }
  return changes;
}

/**
 * Group a `--format=%x1e%H`-prefixed `-z` block, so per-commit name-status and
 * numstat output can be read back keyed by commit.
 */
export function splitPerCommitBlocks(output: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const chunk of output.split(LOG_RECORD_SEPARATOR)) {
    if (!chunk) continue;
    // The sha is followed by a NUL (from -z) or a newline, then the block.
    const separator = chunk.search(/[\0\n]/);
    if (separator === -1) {
      const sha = chunk.trim();
      if (sha) blocks.set(sha, "");
      continue;
    }
    const sha = chunk.slice(0, separator).trim();
    if (sha) blocks.set(sha, chunk.slice(separator + 1));
  }
  return blocks;
}

/** Map the marker files git leaves behind to the sequencer that owns them. */
export function operationFromMarkers(markers: {
  readonly mergeHead: boolean;
  readonly rebaseMerge: boolean;
  readonly rebaseApply: boolean;
  readonly cherryPickHead: boolean;
  readonly revertHead: boolean;
  readonly bisectLog: boolean;
}): ScmOperationState {
  if (markers.rebaseMerge || markers.rebaseApply) return "rebase";
  if (markers.mergeHead) return "merge";
  if (markers.cherryPickHead) return "cherry-pick";
  if (markers.revertHead) return "revert";
  if (markers.bisectLog) return "bisect";
  return "none";
}

/** Infer the hosting provider from a remote URL so the row can carry a glyph. */
export function remoteProvider(url: string | null): string | null {
  if (!url) return null;
  const normalized = url.toLowerCase();
  if (normalized.includes("github.com")) return "github";
  if (normalized.includes("gitlab.com") || normalized.includes("gitlab.")) return "gitlab";
  if (normalized.includes("bitbucket.org")) return "bitbucket";
  if (normalized.includes("dev.azure.com") || normalized.includes("visualstudio.com")) {
    return "azure-devops";
  }
  if (normalized.includes("codeberg.org") || normalized.includes("forgejo")) return "forgejo";
  return null;
}
