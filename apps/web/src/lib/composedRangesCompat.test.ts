import { describe, expect, it } from "vite-plus/test";

import { installComposedRangesCompat } from "./composedRangesCompat";

type Host = NonNullable<Parameters<typeof installComposedRangesCompat>[0]>;

const range = {} as StaticRange;
const shadowRoot = { host: "editor" } as unknown as ShadowRoot;

describe("installComposedRangesCompat", () => {
  it("retries with plain shadow root arguments when the options object is rejected", () => {
    const calls: unknown[][] = [];
    const host = {
      getComposedRanges: (...args: unknown[]) => {
        calls.push(args);
        if (args.some((arg) => arg !== shadowRoot)) throw new TypeError("not a ShadowRoot");
        return [range];
      },
    } as Host;
    installComposedRangesCompat(host);

    expect(host.getComposedRanges({ shadowRoots: [shadowRoot] })).toEqual([range]);
    expect(calls).toEqual([[{ shadowRoots: [shadowRoot] }], [shadowRoot]]);
  });

  it("passes the options object straight through where it is supported", () => {
    const calls: unknown[][] = [];
    const host = {
      getComposedRanges: (...args: unknown[]) => {
        calls.push(args);
        return [range];
      },
    } as Host;
    installComposedRangesCompat(host);

    expect(host.getComposedRanges({ shadowRoots: [shadowRoot] })).toEqual([range]);
    expect(calls).toEqual([[{ shadowRoots: [shadowRoot] }]]);
  });

  it("rethrows errors that are not about the argument form", () => {
    const host = {
      getComposedRanges: () => {
        throw new RangeError("boom");
      },
    } as Host;
    installComposedRangesCompat(host);

    expect(() => host.getComposedRanges({ shadowRoots: [shadowRoot] })).toThrow(RangeError);
  });
});
