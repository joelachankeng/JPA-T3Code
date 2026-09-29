/**
 * The controls at the right of the in-panel diff header: open the file being
 * diffed, walk the changes, and choose how the patch reads. Modelled on the
 * VS Code diff editor's title bar, minus the actions that only make sense
 * when there is an editor area to open a second tab in.
 */
import {
  ArrowDown,
  ArrowUp,
  Columns2Icon,
  FileText,
  PilcrowIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

type ScmDiffToolbarProps = {
  /** Drives the change controls; a whitespace-only diff can render no runs. */
  readonly hasChanges: boolean;
  readonly diffStyle: "unified" | "split";
  readonly ignoreWhitespace: boolean;
  readonly wordWrap: boolean;
  /** Null for a whole-commit diff, which has no single file to open. */
  readonly openFilePath: string | null;
  readonly onOpenFile: (path: string) => void;
  readonly onGoToChange: (direction: "previous" | "next") => void;
  readonly onIgnoreWhitespaceChange: (ignore: boolean) => void;
  readonly onWordWrapChange: (wrap: boolean) => void;
  readonly onDiffStyleChange: (style: "unified" | "split") => void;
};

export function ScmDiffToolbar(props: ScmDiffToolbarProps) {
  const openFilePath = props.openFilePath;
  const split = props.diffStyle === "split";
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Open file"
              disabled={openFilePath === null}
              onClick={() => {
                if (openFilePath !== null) props.onOpenFile(openFilePath);
              }}
            />
          }
        >
          <FileText className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {openFilePath === null ? "This diff covers several files" : "Open file"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Previous change"
              disabled={!props.hasChanges}
              onClick={() => props.onGoToChange("previous")}
            />
          }
        >
          <ArrowUp className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Previous change</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Next change"
              disabled={!props.hasChanges}
              onClick={() => props.onGoToChange("next")}
            />
          }
        >
          <ArrowDown className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Next change</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              variant="ghost"
              size="xs"
              aria-label={
                props.ignoreWhitespace
                  ? "Show whitespace differences"
                  : "Ignore whitespace differences"
              }
              pressed={props.ignoreWhitespace}
              onPressedChange={(pressed) => props.onIgnoreWhitespaceChange(Boolean(pressed))}
            />
          }
        >
          <PilcrowIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {props.ignoreWhitespace ? "Show whitespace differences" : "Ignore whitespace differences"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              variant="ghost"
              size="xs"
              aria-label={props.wordWrap ? "Stop wrapping long lines" : "Wrap long lines"}
              pressed={props.wordWrap}
              onPressedChange={(pressed) => props.onWordWrapChange(Boolean(pressed))}
            />
          }
        >
          <TextWrapIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {props.wordWrap ? "Stop wrapping long lines" : "Wrap long lines"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              variant="ghost"
              size="xs"
              // The icon names the view on screen; the label names what a
              // press does, so the button reads the same way as the
              // whitespace control beside it.
              aria-label={split ? "Switch to compact view" : "Switch to split view"}
              pressed={split}
              onPressedChange={(pressed) => props.onDiffStyleChange(pressed ? "split" : "unified")}
            />
          }
        >
          {split ? <Columns2Icon className="size-3.5" /> : <Rows3Icon className="size-3.5" />}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {split ? "Switch to compact view" : "Switch to split view"}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
