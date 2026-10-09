import { describe, expect, it } from "vite-plus/test";

import { resolveFileFindScrollTop } from "./fileFindReveal";

const viewport = {
  scrollTop: 1_000,
  scrollHeight: 10_000,
  viewportHeight: 400,
  reservedTop: 52,
  lineHeight: 20,
  measured: "rendered" as const,
};

describe("resolveFileFindScrollTop", () => {
  it("leaves a visible match where it is", () => {
    expect(resolveFileFindScrollTop({ ...viewport, lineTop: 1_200 })).toBeNull();
  });

  it("scrolls a match hidden under the find bar into the readable area", () => {
    expect(resolveFileFindScrollTop({ ...viewport, lineTop: 1_020 })).toBe(804);
  });

  it("centers a match below the viewport in the space under the find bar", () => {
    expect(resolveFileFindScrollTop({ ...viewport, lineTop: 5_000 })).toBe(4_784);
  });

  it("never scrolls past the top", () => {
    expect(resolveFileFindScrollTop({ ...viewport, scrollTop: 500, lineTop: 10 })).toBe(0);
  });

  it("never scrolls past the end of the content", () => {
    expect(resolveFileFindScrollTop({ ...viewport, lineTop: 9_990 })).toBe(9_600);
  });

  it("keeps scrolling toward an estimate that claims the match is already visible", () => {
    // The virtualizer's estimate for an unmounted row can land inside the
    // viewport while the row itself is thousands of pixels away, so only a
    // mounted row may end the reveal.
    expect(resolveFileFindScrollTop({ ...viewport, measured: "estimated", lineTop: 1_200 })).toBe(
      984,
    );
  });
});
