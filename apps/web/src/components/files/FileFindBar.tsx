import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  RegexIcon,
  ReplaceAllIcon,
  ReplaceIcon,
  WholeWordIcon,
  XIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { formatFileFindCount, type FileFindOptions } from "./fileFind";

export type FileFindMode = "find" | "replace";

interface FileFindBarProps {
  readonly open: boolean;
  readonly mode: FileFindMode;
  /** Absent while the surface has nothing to replace into. */
  readonly onReplace?: (() => void) | undefined;
  readonly onReplaceAll?: (() => void) | undefined;
  readonly query: string;
  readonly replaceQuery: string;
  readonly options: FileFindOptions;
  readonly matchCount: number;
  readonly activeIndex: number;
  /** A regular expression the reader is still halfway through typing. */
  readonly invalidPattern: boolean;
  readonly focusField: FileFindMode;
  readonly focusRequestId: number;
  readonly onQueryChange: (query: string) => void;
  readonly onReplaceQueryChange: (query: string) => void;
  /** An updater, so two toggles changed in one tick cannot overwrite each other. */
  readonly onOptionsChange: (update: (current: FileFindOptions) => FileFindOptions) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

function FileFindOptionToggle(props: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            variant="ghost"
            size="xs"
            pressed={props.pressed}
            onPressedChange={props.onPress}
            aria-label={props.label}
          >
            {props.children}
          </Toggle>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Find, and in an editable surface replace, inside the open file. It floats over
 * the top of the surface the way thread find floats over the chat canvas, so the
 * rows underneath keep their own scroll position.
 */
export function FileFindBar(props: FileFindBarProps) {
  const queryRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const replacing = props.mode === "replace" && props.onReplace !== undefined;

  // Opening find bumps `focusRequestId`, including when it switches the field,
  // so that is the only trigger needed to pull focus into the right input.
  useEffect(() => {
    if (!props.open) return;
    const input = props.focusField === "replace" ? replaceRef.current : queryRef.current;
    input?.focus();
    input?.select();
  }, [props.focusField, props.focusRequestId, props.open]);

  if (!props.open) return null;

  const hasQuery = props.query.length > 0;
  const noMatches = hasQuery && props.matchCount === 0;
  const countLabel = props.invalidPattern
    ? "Bad pattern"
    : hasQuery
      ? formatFileFindCount(props.activeIndex, props.matchCount)
      : "";
  const navigationDisabled = props.matchCount === 0;

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) props.onPrevious();
    else props.onNext();
  };

  const handleReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) props.onReplaceAll?.();
    else props.onReplace?.();
  };

  return (
    <div
      role="search"
      aria-label="Find in file"
      className="absolute top-3 right-3 z-40 flex w-[min(26rem,calc(100%-1.5rem))] flex-col gap-1.5"
    >
      <InputGroup variant="popover" size="lg" onContextMenu={(event) => event.stopPropagation()}>
        <InputGroupInput
          ref={queryRef}
          type="text"
          size="sm"
          value={props.query}
          aria-label="Find in file"
          aria-invalid={props.invalidPattern || noMatches}
          placeholder="Find in file"
          maxLength={500}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={handleQueryKeyDown}
        />
        <InputGroupAddon align="inline-end" inset="pill">
          <span
            aria-live="polite"
            className={cn(
              "min-w-10 text-center text-xs tabular-nums",
              props.invalidPattern || noMatches ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {countLabel}
          </span>
          <FileFindOptionToggle
            label="Match case"
            pressed={props.options.caseSensitive}
            onPress={() =>
              props.onOptionsChange((current) => ({
                ...current,
                caseSensitive: !current.caseSensitive,
              }))
            }
          >
            <CaseSensitiveIcon />
          </FileFindOptionToggle>
          <FileFindOptionToggle
            label="Match whole word"
            pressed={props.options.wholeWord}
            onPress={() =>
              props.onOptionsChange((current) => ({ ...current, wholeWord: !current.wholeWord }))
            }
          >
            <WholeWordIcon />
          </FileFindOptionToggle>
          <FileFindOptionToggle
            label="Use regular expression"
            pressed={props.options.regex}
            onPress={() =>
              props.onOptionsChange((current) => ({ ...current, regex: !current.regex }))
            }
          >
            <RegexIcon />
          </FileFindOptionToggle>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={navigationDisabled}
            onClick={props.onPrevious}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next match"
            disabled={navigationDisabled}
            onClick={props.onNext}
          >
            <ChevronDownIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={props.onClose}>
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {replacing ? (
        <InputGroup variant="popover" size="lg" onContextMenu={(event) => event.stopPropagation()}>
          <InputGroupInput
            ref={replaceRef}
            type="text"
            size="sm"
            value={props.replaceQuery}
            aria-label="Replace with"
            placeholder="Replace with"
            maxLength={500}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => props.onReplaceQueryChange(event.target.value)}
            onKeyDown={handleReplaceKeyDown}
          />
          <InputGroupAddon align="inline-end" inset="pill">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Replace match"
                    disabled={navigationDisabled}
                    onClick={props.onReplace}
                  >
                    <ReplaceIcon />
                  </Button>
                }
              />
              <TooltipPopup>Replace match</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Replace all matches"
                    disabled={navigationDisabled}
                    onClick={props.onReplaceAll}
                  >
                    <ReplaceAllIcon />
                  </Button>
                }
              />
              <TooltipPopup>Replace all matches</TooltipPopup>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      ) : null}
    </div>
  );
}
