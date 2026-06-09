import { describe, expect, it } from "vitest";

import { toProjectIdentity } from "./project-identity";

describe("toProjectIdentity", () => {
  it("hashes projects in hashed mode and preserves the raw name as label", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "hashed",
      salt: "secret-salt",
    });

    expect(result.projectKey).toHaveLength(16);
    expect(result.projectLabel).toBe("tokenarena");
  });

  it("uses the raw project in both fields in raw mode", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "raw",
      salt: "secret-salt",
    });

    expect(result.projectKey).toBe("tokenarena");
    expect(result.projectLabel).toBe("tokenarena");
  });

  it("preserves the raw name in disabled mode but still uses the unknown key", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "disabled",
      salt: "secret-salt",
    });

    expect(result.projectKey).toBe("unknown");
    expect(result.projectLabel).toBe("tokenarena");
  });
});
