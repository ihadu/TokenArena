import { createHmac } from "node:crypto";

export function toProjectIdentity(input: {
  project: string;
  mode: "hashed" | "raw" | "disabled";
  salt: string;
}) {
  if (input.mode === "disabled") {
    return { projectKey: "unknown", projectLabel: input.project };
  }

  if (input.mode === "raw") {
    return { projectKey: input.project, projectLabel: input.project };
  }

  const projectKey = createHmac("sha256", input.salt)
    .update(input.project)
    .digest("hex")
    .slice(0, 16);

  return { projectKey, projectLabel: input.project };
}
