import type { ProjectMode } from "./types";

export type ProjectDisplayRow = {
  key: string;
  name: string;
};

export function getProjectDisplayLabel(
  row: ProjectDisplayRow,
  options: { projectMode: ProjectMode; viewerIsAdmin: boolean },
): string {
  if (options.viewerIsAdmin) {
    return row.name;
  }

  switch (options.projectMode) {
    case "hashed":
      return `Project ${row.key.slice(0, 6)}`;
    case "raw":
      return row.name;
    case "disabled":
      return "Unknown Project";
  }
}
