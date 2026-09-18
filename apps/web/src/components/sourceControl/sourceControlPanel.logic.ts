/**
 * Pure helpers behind the Source Control surface: the letters and colours git
 * status maps to, the list/tree shaping the view toggle switches between, and
 * the graph lane assignment. Kept away from React so the behaviour the surface
 * promises can be tested directly.
 */
import type { ScmCommit, ScmFileEntry } from "@t3tools/contracts";

/** The single letter VS Code puts at the right of a changed-file row. */
export function statusLetter(entry: Pick<ScmFileEntry, "index" | "worktree">): string {
  const state = entry.worktree === "unmodified" ? entry.index : entry.worktree;
  switch (state) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "ignored":
      return "I";
    case "conflicted":
      return "C";
    case "type-changed":
      return "T";
    case "unmodified":
      return "";
  }
}

/** Tailwind colour token per state, matching VS Code's decoration colours. */
export function statusToneClassName(entry: Pick<ScmFileEntry, "index" | "worktree">): string {
  const state = entry.worktree === "unmodified" ? entry.index : entry.worktree;
  switch (state) {
    case "added":
    case "untracked":
      return "text-success";
    case "deleted":
      return "text-destructive-foreground";
    case "conflicted":
      return "text-warning";
    case "ignored":
      return "text-muted-foreground";
    default:
      return "text-info";
  }
}

export function statusTitle(
  entry: Pick<ScmFileEntry, "index" | "worktree" | "conflicted">,
): string {
  if (entry.conflicted) return "Conflicted";
  const state = entry.worktree === "unmodified" ? entry.index : entry.worktree;
  switch (state) {
    case "modified":
      return "Modified";
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "untracked":
      return "Untracked";
    case "ignored":
      return "Ignored";
    case "type-changed":
      return "Type changed";
    case "conflicted":
      return "Conflicted";
    case "unmodified":
      return "Unchanged";
  }
}

export function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index === -1 ? path : path.slice(index + 1);
}

export function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** A row in the changes list, in either the list or the tree presentation. */
export type ScmTreeRow =
  | { kind: "directory"; id: string; path: string; label: string; depth: number; fileCount: number }
  | { kind: "file"; id: string; entry: ScmFileEntry; label: string; depth: number };

/** VS Code's "View as List": one row per file, the folder shown as dimmed context. */
export function buildListRows(entries: readonly ScmFileEntry[]): ScmTreeRow[] {
  return entries.map((entry) => ({
    kind: "file",
    id: entry.path,
    entry,
    label: fileName(entry.path),
    depth: 0,
  }));
}

/**
 * VS Code's "View as Tree": directories are nested, and a chain of directories
 * with a single child is compacted into one row ("src/components/ui").
 */
export function buildTreeRows(
  entries: readonly ScmFileEntry[],
  collapsedPaths: ReadonlySet<string>,
): ScmTreeRow[] {
  interface Node {
    readonly segment: string;
    readonly children: Map<string, Node>;
    readonly files: ScmFileEntry[];
  }
  const root: Node = { segment: "", children: new Map(), files: [] };

  for (const entry of entries) {
    const segments = entry.path.split("/");
    const name = segments.pop();
    if (name === undefined) continue;
    let node = root;
    for (const segment of segments) {
      let next = node.children.get(segment);
      if (!next) {
        next = { segment, children: new Map(), files: [] };
        node.children.set(segment, next);
      }
      node = next;
    }
    node.files.push(entry);
  }

  const countFiles = (node: Node): number =>
    node.files.length +
    [...node.children.values()].reduce((total, child) => total + countFiles(child), 0);

  const rows: ScmTreeRow[] = [];
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const child of [...node.children.values()].sort((left, right) =>
      left.segment.localeCompare(right.segment),
    )) {
      // Compact a run of single-child directories into one row.
      let compacted = child;
      let label = child.segment;
      let path = prefix ? `${prefix}/${child.segment}` : child.segment;
      while (compacted.files.length === 0 && compacted.children.size === 1) {
        const [only] = [...compacted.children.values()];
        if (!only) break;
        label = `${label}/${only.segment}`;
        path = `${path}/${only.segment}`;
        compacted = only;
      }
      rows.push({
        kind: "directory",
        id: path,
        path,
        label,
        depth,
        fileCount: countFiles(compacted),
      });
      if (collapsedPaths.has(path)) continue;
      walk(compacted, path, depth + 1);
    }
    for (const entry of node.files) {
      rows.push({ kind: "file", id: entry.path, entry, label: fileName(entry.path), depth });
    }
  };
  walk(root, "", 0);
  return rows;
}

/**
 * Assign each commit a lane and record the edges into the next row, which is
 * what the graph gutter draws.
 *
 * The algorithm is the one a linear-first history wants: a row takes the
 * leftmost lane already waiting for its sha, or a new lane when nothing is;
 * its first parent inherits that lane, and further parents (a merge) open
 * lanes to the right. A history with no merges therefore collapses to a single
 * lane, which is exactly what a repository without pull requests should look
 * like.
 */
export interface GraphRow {
  readonly sha: string;
  readonly lane: number;
  /** Lanes occupied immediately above this row, for drawing pass-through lines. */
  readonly incoming: readonly (string | null)[];
  /** Lanes occupied immediately below, so an edge can be drawn between them. */
  readonly outgoing: readonly (string | null)[];
  /** Lane each parent continues into, in parent order. */
  readonly parentLanes: readonly number[];
}

export function buildGraphRows(commits: readonly ScmCommit[]): GraphRow[] {
  // `lanes[i]` holds the sha the lane is currently waiting to draw, or null.
  let lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const incoming = [...lanes];
    let lane = lanes.indexOf(commit.sha);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }
    // Any other lane waiting for the same commit merges into this one.
    for (const [index, value] of lanes.entries()) {
      if (index !== lane && value === commit.sha) lanes[index] = null;
    }

    const parentLanes: number[] = [];
    const [firstParent, ...otherParents] = commit.parents;
    lanes[lane] = firstParent ?? null;
    if (firstParent) parentLanes.push(lane);

    for (const parent of otherParents) {
      let parentLane = lanes.indexOf(parent);
      if (parentLane === -1) {
        parentLane = lanes.indexOf(null);
        if (parentLane === -1) {
          parentLane = lanes.length;
          lanes.push(parent);
        } else {
          lanes[parentLane] = parent;
        }
      }
      parentLanes.push(parentLane);
    }

    // Trailing empty lanes would otherwise widen the gutter forever.
    while (lanes.length > 0 && lanes.at(-1) === null) lanes = lanes.slice(0, -1);

    rows.push({ sha: commit.sha, lane, incoming, outgoing: [...lanes], parentLanes });
  }

  return rows;
}

/** Widest lane index any row uses, so the gutter can be sized once. */
export function graphWidth(rows: readonly GraphRow[]): number {
  let width = 1;
  for (const row of rows) {
    width = Math.max(width, row.lane + 1, row.incoming.length, row.outgoing.length);
  }
  return width;
}

/**
 * GitLens-style relative time: short units that stay legible in a dense row,
 * and never a bare number of days once a week has passed.
 */
export function formatScmRelativeTime(isoDate: string, nowMs: number = Date.now()): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "wk" : "wks"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "mo" : "mos"}`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "yr" : "yrs"}`;
}

/** The long form GitLens puts in a hover: "2 weeks ago (August 27th, 2026 5:25 PM)". */
export function formatScmAbsoluteTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** What the commit button says, given what is staged and which mode is chosen. */
export function commitButtonLabel(input: {
  readonly stagedCount: number;
  readonly changesCount: number;
  readonly amend: boolean;
}): string {
  // VS Code keeps the button reading "Commit" whether or not anything is
  // staged, and stages everything itself when nothing is. The tooltip carries
  // the difference, so the button does not change width as files are staged.
  return input.amend ? "Commit (Amend)" : "Commit";
}

/**
 * Why the commit button is disabled, or null when it is not. VS Code keeps the
 * button live and explains the refusal, which is friendlier than a dead control.
 */
export function commitDisabledReason(input: {
  readonly message: string;
  readonly stagedCount: number;
  readonly changesCount: number;
  readonly mergeCount: number;
  readonly amend: boolean;
  readonly busy: boolean;
}): string | null {
  if (input.busy) return "A git operation is already running.";
  if (input.mergeCount > 0) return "Resolve the merge conflicts before committing.";
  if (input.message.trim().length === 0 && !input.amend) return "Enter a commit message.";
  if (!input.amend && input.stagedCount === 0 && input.changesCount === 0) {
    return "There are no changes to commit.";
  }
  return null;
}

/** Ahead/behind summary for the sync button's tooltip and its badge. */
export function syncLabel(input: {
  readonly ahead: number;
  readonly behind: number;
  readonly upstream: string | null;
  readonly branch: string | null;
}): string {
  if (!input.upstream) {
    return input.branch ? `Publish Branch "${input.branch}"` : "Publish Branch";
  }
  if (input.ahead === 0 && input.behind === 0) return `Up to date with ${input.upstream}`;
  const parts: string[] = [];
  if (input.behind > 0) parts.push(`${input.behind} to pull`);
  if (input.ahead > 0) parts.push(`${input.ahead} to push`);
  return `Sync Changes — ${parts.join(", ")}`;
}
