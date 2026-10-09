import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FILE_FIND_OPTIONS,
  compileFileFindPattern,
  fileFindReplacement,
  findFileMatches,
  firstFileFindIndexFrom,
  firstFileFindIndexFromLine,
  formatFileFindCount,
  stepFileFindIndex,
  type FileFindOptions,
} from "./fileFind";

const options = (overrides: Partial<FileFindOptions> = {}): FileFindOptions => ({
  ...DEFAULT_FILE_FIND_OPTIONS,
  ...overrides,
});

describe("findFileMatches", () => {
  it("reports document offsets with one-based lines and in-line columns", () => {
    expect(findFileMatches("const a = 1;\nconst b = 2;\n", "const", options())).toEqual([
      { start: 0, end: 5, line: 1, column: 0, text: "const" },
      { start: 13, end: 18, line: 2, column: 0, text: "const" },
    ]);
  });

  it("ignores case until match case is on", () => {
    expect(findFileMatches("Foo foo", "foo", options()).length).toBe(2);
    expect(findFileMatches("Foo foo", "foo", options({ caseSensitive: true }))).toEqual([
      { start: 4, end: 7, line: 1, column: 4, text: "foo" },
    ]);
  });

  it("treats the query literally until regex is on", () => {
    expect(findFileMatches("a.c abc", "a.c", options())).toEqual([
      { start: 0, end: 3, line: 1, column: 0, text: "a.c" },
    ]);
    expect(findFileMatches("a.c abc", "a.c", options({ regex: true })).length).toBe(2);
  });

  it("keeps a match inside its own line", () => {
    // A greedy pattern must not run past the line break into the next row.
    expect(findFileMatches("one\ntwo\n", ".+", options({ regex: true }))).toEqual([
      { start: 0, end: 3, line: 1, column: 0, text: "one" },
      { start: 4, end: 7, line: 2, column: 0, text: "two" },
    ]);
  });

  it("anchors a regular expression to each line", () => {
    expect(findFileMatches("ab\nba\n", "^b", options({ regex: true }))).toEqual([
      { start: 3, end: 4, line: 2, column: 0, text: "b" },
    ]);
  });

  it("skips partial words when whole word is on", () => {
    expect(findFileMatches("find finder", "find", options({ wholeWord: true }))).toEqual([
      { start: 0, end: 4, line: 1, column: 0, text: "find" },
    ]);
  });

  it("drops zero-length matches rather than looping on them", () => {
    expect(findFileMatches("aa\n", "b*", options({ regex: true }))).toEqual([]);
  });

  it("finds a match on a last line without a trailing newline", () => {
    expect(findFileMatches("one\ntwo", "two", options())).toEqual([
      { start: 4, end: 7, line: 2, column: 0, text: "two" },
    ]);
  });

  it("ignores a carriage return at the end of a line", () => {
    expect(findFileMatches("one\r\n", "one.", options({ regex: true }))).toEqual([]);
  });

  it("has nothing to match for an empty query", () => {
    expect(findFileMatches("anything", "", options())).toEqual([]);
  });
});

describe("compileFileFindPattern", () => {
  it("rejects a half-typed regular expression instead of throwing", () => {
    expect(compileFileFindPattern("(unclosed", options({ regex: true }))).toBeNull();
    expect(compileFileFindPattern("(unclosed", options())).not.toBeNull();
  });
});

describe("fileFindReplacement", () => {
  const match = { start: 0, end: 7, line: 1, column: 0, text: "foo=bar" };

  it("inserts a literal replacement verbatim", () => {
    expect(fileFindReplacement(match, "foo=bar", "$1 kept", options())).toBe("$1 kept");
  });

  it("expands capture groups for a regular expression", () => {
    expect(fileFindReplacement(match, "(\\w+)=(\\w+)", "$2=$1", options({ regex: true }))).toBe(
      "bar=foo",
    );
  });
});

describe("stepFileFindIndex", () => {
  it("wraps in both directions", () => {
    expect(stepFileFindIndex(2, 3, 1)).toBe(0);
    expect(stepFileFindIndex(0, 3, -1)).toBe(2);
  });

  it("stays at zero with nothing to step through", () => {
    expect(stepFileFindIndex(5, 0, 1)).toBe(0);
  });
});

describe("formatFileFindCount", () => {
  it("counts from one and reports an empty result", () => {
    expect(formatFileFindCount(0, 3)).toBe("1/3");
    expect(formatFileFindCount(9, 3)).toBe("3/3");
    expect(formatFileFindCount(0, 0)).toBe("0/0");
  });
});

describe("picking the match a query lands on", () => {
  const matches = findFileMatches("a\nb\na\nb\na\n", "a", options());

  it("starts from the top of the viewport", () => {
    expect(firstFileFindIndexFromLine(matches, 3)).toBe(1);
    expect(firstFileFindIndexFromLine(matches, 99)).toBe(0);
  });

  it("stays where a replacement left off", () => {
    expect(firstFileFindIndexFrom(matches, 4)).toBe(1);
    expect(firstFileFindIndexFrom(matches, 99)).toBe(0);
  });
});
