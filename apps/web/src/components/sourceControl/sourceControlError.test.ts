import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { sourceControlErrorMessage } from "./sourceControlError";

describe("sourceControlErrorMessage", () => {
  it("reports git's own words for a failed command", () => {
    const message = sourceControlErrorMessage(
      Cause.fail(new Error("Git command failed in Scm.commit (/repo): nothing to commit")),
    );
    expect(message).toBe("Git command failed in Scm.commit (/repo): nothing to commit");
  });

  it("names the environment when its server has no source control handlers", () => {
    // An older server answers every scm.* request with this bare string defect.
    const message = sourceControlErrorMessage(Cause.die("Unknown request tag: scm.status"));
    expect(message).toContain("newer T3 Code on this environment");
  });

  it("reports an unreachable environment instead of blaming git", () => {
    const message = sourceControlErrorMessage(Cause.fail(new Error("Workshop is not connected.")));
    expect(message).toBe("Workshop is not connected.");
  });

  it("falls back to git for a failure that carries no words", () => {
    expect(sourceControlErrorMessage(Cause.fail(new Error("")))).toBe("The git command failed.");
    expect(sourceControlErrorMessage(Cause.die({ exitCode: 128 }))).toBe("The git command failed.");
  });
});
