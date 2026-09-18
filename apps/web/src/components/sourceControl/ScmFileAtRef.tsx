/**
 * A file as a revision has it, for "Open File (HEAD)". Mounted only while it
 * is shown, so the file is read once per opening rather than kept warm.
 */
import { File, Virtualizer } from "@pierre/diffs/react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { useScmShow, type ScmTarget } from "./useSourceControl";

/** A short content hash, so a moved HEAD never reuses another version's highlighting. */
function contentKey(contents: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < contents.length; index += 1) {
    hash = Math.imul(hash ^ contents.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function ScmFileAtRef(props: {
  readonly target: ScmTarget;
  readonly path: string;
  readonly gitRef: string;
}) {
  const { resolvedTheme } = useTheme();
  const shown = useScmShow(props.target, props.path, props.gitRef);
  const data = shown.data;

  if (shown.error) {
    return <p className="px-3 py-3 text-destructive-foreground text-xs">{shown.error}</p>;
  }
  if (!data) {
    return <p className="px-3 py-3 text-muted-foreground text-xs">Loading file…</p>;
  }
  if (!data.exists) {
    return (
      <p className="px-3 py-3 text-muted-foreground text-xs">
        {props.gitRef} does not have this file.
      </p>
    );
  }
  if (data.binary) {
    return (
      <p className="px-3 py-3 text-muted-foreground text-xs">
        This file is binary, so there is no text to show.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {data.truncated ? (
        <p className="shrink-0 px-3 py-1.5 text-muted-foreground text-[11px]">
          This file is large, so only its beginning is shown.
        </p>
      ) : null}
      <Virtualizer className="min-h-0 flex-1 overflow-auto">
        <File
          file={{
            name: data.path,
            contents: data.contents,
            cacheKey: `scm-show:${props.gitRef}:${data.path}:${contentKey(data.contents)}`,
          }}
          options={{
            disableFileHeader: true,
            overflow: "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
          }}
        />
      </Virtualizer>
    </div>
  );
}
