type ComposedRangesArgs = Parameters<Selection["getComposedRanges"]>;

interface ComposedRangesHost {
  getComposedRanges: (...args: ComposedRangesArgs) => StaticRange[];
}

/**
 * Safari 17 and 18 only accept shadow roots as plain arguments to
 * `getComposedRanges` and throw on the standard `{ shadowRoots }` options
 * object. The file editor calls the standard form to find the caret inside
 * its shadow root, so without this it never learns the caret and drops every
 * keystroke and paste. Call once at startup, before any editor mounts.
 */
export function installComposedRangesCompat(
  host: ComposedRangesHost | undefined = globalThis.Selection?.prototype,
): void {
  const native = host?.getComposedRanges;
  if (host === undefined || typeof native !== "function") return;

  host.getComposedRanges = function getComposedRanges(this: Selection, ...args) {
    try {
      return native.apply(this, args);
    } catch (error) {
      const [options] = args;
      if (!(error instanceof TypeError) || options === undefined || !("shadowRoots" in options)) {
        throw error;
      }
      const legacyArgs: unknown[] = options.shadowRoots ?? [];
      return native.apply(this, legacyArgs as ComposedRangesArgs);
    }
  };
}
