/**
 * The quick pick behind "Open Folder Changes with Revision…" and "…with Branch
 * or Tag…". It reuses the command palette's chrome so it looks and drives like
 * every other picker in the app. Its data is only requested while it is open.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Cloud, GitBranch, GitCommitHorizontal, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { CommandDialog, CommandDialogPopup } from "../ui/command";

import { formatScmRelativeTime } from "./sourceControlPanel.logic";
import { useScmLog, useScmView } from "./useSourceControl";

export type ScmRefPickerKind = "revision" | "ref";

export interface ScmRefChoice {
  /** Anything `git diff` accepts as a revision: a sha, a branch or a tag. */
  readonly ref: string;
  /** How the comparison is named once chosen, such as a short sha or a branch. */
  readonly label: string;
}

function matches(query: string, terms: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return terms.some((term) => term.toLowerCase().includes(needle));
}

function RevisionItems(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly query: string;
  readonly onChoose: (choice: ScmRefChoice) => void;
  readonly render: (
    items: CommandPaletteActionItem[],
    state: { isPending: boolean; error: string | null },
  ) => React.ReactNode;
}) {
  // Only the commits that touched this folder, as GitLens offers.
  const log = useScmLog(
    { environmentId: props.environmentId, cwd: props.cwd },
    { path: props.path, limit: 200 },
  );
  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      (log.data?.commits ?? [])
        .filter((commit) =>
          matches(props.query, [commit.subject, commit.shortSha, commit.authorName]),
        )
        .map((commit) => ({
          kind: "action",
          value: `revision:${commit.sha}`,
          searchTerms: [commit.subject, commit.shortSha, commit.authorName],
          title: commit.subject || "(no message)",
          description: `${commit.shortSha} · ${commit.authorName} · ${formatScmRelativeTime(commit.authorDate)}`,
          icon: <GitCommitHorizontal className="size-4 text-muted-foreground" />,
          run: async () => props.onChoose({ ref: commit.sha, label: commit.shortSha }),
        })),
    [log.data, props],
  );
  return <>{props.render(items, { isPending: log.isPending, error: log.error })}</>;
}

function RefItems(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly query: string;
  readonly onChoose: (choice: ScmRefChoice) => void;
  readonly render: (
    items: CommandPaletteActionItem[],
    state: { isPending: boolean; error: string | null },
  ) => React.ReactNode;
}) {
  const target = { environmentId: props.environmentId, cwd: props.cwd };
  const branches = useScmView(target, { view: "branches", includeRemote: true });
  const tags = useScmView(target, { view: "tags" });
  const items = useMemo<CommandPaletteActionItem[]>(() => {
    const branchNodes = branches.data?._tag === "branches" ? branches.data.branches : [];
    const tagNodes = tags.data?._tag === "tags" ? tags.data.tags : [];
    return [
      ...branchNodes.map((branch): CommandPaletteActionItem => ({
        kind: "action",
        value: `branch:${branch.name}`,
        searchTerms: [branch.name],
        title: branch.name,
        description: branch.current ? "Current branch" : branch.subject,
        icon: branch.remote ? (
          <Cloud className="size-4 text-muted-foreground" />
        ) : (
          <GitBranch className="size-4 text-muted-foreground" />
        ),
        run: async () => props.onChoose({ ref: branch.name, label: branch.name }),
      })),
      ...tagNodes.map((tag): CommandPaletteActionItem => ({
        kind: "action",
        value: `tag:${tag.name}`,
        searchTerms: [tag.name],
        title: tag.name,
        description: tag.subject,
        icon: <Tag className="size-4 text-muted-foreground" />,
        run: async () => props.onChoose({ ref: tag.name, label: tag.name }),
      })),
    ].filter((item) => matches(props.query, item.searchTerms));
  }, [branches.data, tags.data, props]);
  return (
    <>
      {props.render(items, {
        isPending: branches.isPending || tags.isPending,
        error: branches.error ?? tags.error,
      })}
    </>
  );
}

export function ScmRefPickerDialog(props: {
  readonly open: boolean;
  readonly kind: ScmRefPickerKind;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The file or folder being acted on; it narrows the revisions offered. */
  readonly path: string;
  /** What the picker is for, shown in its input. Defaults to a comparison prompt. */
  readonly prompt?: string;
  /** Label for Enter in the footer. */
  readonly actionLabel?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChoose: (choice: ScmRefChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const label =
    props.prompt ??
    (props.kind === "revision"
      ? `Choose a commit to compare ${props.path} with`
      : `Choose a branch or tag to compare ${props.path} with`);

  const choose = (choice: ScmRefChoice) => {
    props.onOpenChange(false);
    props.onChoose(choice);
  };

  const render = (
    items: CommandPaletteActionItem[],
    state: { isPending: boolean; error: string | null },
  ) => (
    <CommandPaletteResults
      groups={
        items.length > 0
          ? [
              {
                value: props.kind,
                label: props.kind === "revision" ? "Commits" : "Branches and tags",
                items,
              },
            ]
          : []
      }
      highlightedItemValue={highlighted}
      isActionsOnly={false}
      keybindings={keybindings}
      onExecuteItem={(item) => {
        if (item.kind !== "action") return;
        void item.run();
      }}
      emptyStateMessage={
        state.error ??
        (state.isPending
          ? "Loading…"
          : query.trim()
            ? "Nothing matches."
            : props.kind === "revision"
              ? "No commits touch this path."
              : "No branches or tags.")
      }
    />
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <CommandDialogPopup
          aria-label={label}
          className="overflow-hidden p-0"
          onBackdropPointerDown={() => props.onOpenChange(false)}
        >
          <CommandPaletteContent
            aria-label={label}
            autoHighlight="always"
            escapeLabel="Close"
            footerActionLabel={props.actionLabel ?? "Compare"}
            inputProps={{ placeholder: label }}
            mode="none"
            onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
            onValueChange={(value) => {
              setHighlighted(null);
              setQuery(value);
            }}
            panelClassName="max-h-[min(34rem,76vh)]"
            testId="scm-ref-picker"
            value={query}
          >
            {props.kind === "revision" ? (
              <RevisionItems
                environmentId={props.environmentId}
                cwd={props.cwd}
                path={props.path}
                query={query}
                onChoose={choose}
                render={render}
              />
            ) : (
              <RefItems
                environmentId={props.environmentId}
                cwd={props.cwd}
                query={query}
                onChoose={choose}
                render={render}
              />
            )}
          </CommandPaletteContent>
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}
