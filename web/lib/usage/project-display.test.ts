import { describe, expect, it } from "vitest";

import { getProjectDisplayLabel } from "./project-display";

describe("getProjectDisplayLabel", () => {
  it("returns the raw label for an admin viewer", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: true },
      ),
    ).toBe("my-project");
  });

  it("returns the raw label for a self viewer in raw mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "my-project", name: "my-project" },
        { projectMode: "raw", viewerIsAdmin: false },
      ),
    ).toBe("my-project");
  });

  it("returns the truncated Project form for a self viewer in hashed mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: false },
      ),
    ).toBe("Project abc123");
  });

  it("returns the Unknown Project form for a self viewer in disabled mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "unknown", name: "my-project" },
        { projectMode: "disabled", viewerIsAdmin: false },
      ),
    ).toBe("Unknown Project");
  });

  it("ignores disabled mode for admin viewers and returns raw label", () => {
    expect(
      getProjectDisplayLabel(
        { key: "unknown", name: "my-project" },
        { projectMode: "disabled", viewerIsAdmin: true },
      ),
    ).toBe("my-project");
  });

  it("uses the truncated key prefix for hashed mode when key length is at least 6", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abcdef0000000000", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: false },
      ),
    ).toBe("Project abcdef");
  });
});
