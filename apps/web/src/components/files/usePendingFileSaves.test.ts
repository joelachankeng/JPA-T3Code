import { describe, expect, it } from "vite-plus/test";

import { hasPendingSaveUnder } from "./usePendingFileSaves";

describe("hasPendingSaveUnder", () => {
  const pending = new Set(["file:src/app.ts", "file:docs/guides/intro.md"]);

  it("matches the file itself and files inside a folder", () => {
    expect(hasPendingSaveUnder(pending, "src/app.ts")).toBe(true);
    expect(hasPendingSaveUnder(pending, "docs")).toBe(true);
    expect(hasPendingSaveUnder(pending, "docs/guides")).toBe(true);
  });

  it("ignores siblings that only share a name prefix", () => {
    expect(hasPendingSaveUnder(pending, "src/app")).toBe(false);
    expect(hasPendingSaveUnder(pending, "doc")).toBe(false);
    expect(hasPendingSaveUnder(new Set(["file:srcs/a.ts"]), "src")).toBe(false);
  });
});
