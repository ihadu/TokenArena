import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Decompress } from "fzstd";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { logger } from "../utils/logger";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "deepseek-harness";
const TOOL_NAME = "DeepSeek Harness";
const SUPPORTED_SESSION_VERSION = 4;
const SESSION_FILE_PATTERN = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/;

function resolveDefaultDataDir(): string {
  const home = process.env.DSH_HOME?.trim();
  return join(home || join(homedir(), ".dsh"), "sessions");
}

export const DEEPSEEK_HARNESS_DATA_DIR = resolveDefaultDataDir();

interface DshUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface DshEvent {
  type?: string;
  version?: number;
  id?: string;
  cwd?: string;
  time?: number;
  data?: {
    usage?: DshUsage;
    message?: {
      source?: {
        model?: string;
      };
    };
    source?: {
      kind?: string;
    };
    model?: string;
    header?: {
      config?: {
        model?: string;
      };
    };
  };
}

interface SessionFile {
  filePath: string;
  version: number;
  compressed: boolean;
}

export interface DeepSeekHarnessParserOptions {
  dataDir?: string;
}

function createToolDefinition(dataDir: string): ToolDefinition {
  return {
    id: TOOL_ID,
    name: TOOL_NAME,
    dataDir,
  };
}

function toSafeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function getPathLeaf(value: string | undefined): string {
  if (!value) return "unknown";
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const leaf = normalized.split("/").filter(Boolean).pop();
  return leaf || "unknown";
}

function parseSessionFileName(
  fileName: string,
): { version: number; compressed: boolean } | null {
  const match = SESSION_FILE_PATTERN.exec(fileName);
  if (!match) return null;

  const version = match[1] ? Number.parseInt(match[1], 10) : 0;
  if (!Number.isSafeInteger(version) || version < 0) return null;

  return { version, compressed: Boolean(match[2]) };
}

function pickSessionFile(directory: string): SessionFile | null {
  let selected: SessionFile | null = null;

  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return null;
  }

  for (const fileName of entries) {
    const parsed = parseSessionFileName(fileName);
    if (!parsed) continue;

    if (
      !selected ||
      parsed.version > selected.version ||
      (parsed.version === selected.version &&
        parsed.compressed &&
        !selected.compressed)
    ) {
      selected = {
        filePath: join(directory, fileName),
        version: parsed.version,
        compressed: parsed.compressed,
      };
    }
  }

  return selected;
}

function findSessionFiles(baseDir: string): SessionFile[] {
  const results: SessionFile[] = [];
  if (!existsSync(baseDir)) return results;

  let projects: string[];
  try {
    projects = readdirSync(baseDir);
  } catch {
    return results;
  }

  for (const project of projects) {
    const projectDir = join(baseDir, project);
    let sessions: string[];
    try {
      sessions = readdirSync(projectDir);
    } catch {
      continue;
    }

    for (const session of sessions) {
      const sessionFile = pickSessionFile(join(projectDir, session));
      if (sessionFile) results.push(sessionFile);
    }
  }

  return results;
}

/**
 * Decode DSH's concatenated Zstandard frames.
 *
 * The session backend writes one frame for the header and one per append
 * batch, so a single file holds multiple independent frames. A session that
 * is still being written may end mid-frame; complete blocks decoded before
 * the torn tail are kept.
 */
export function decompressZstd(data: Uint8Array): string {
  const chunks: Uint8Array[] = [];
  let total = 0;

  const stream = new Decompress((chunk) => {
    if (chunk.length === 0) return;
    chunks.push(chunk);
    total += chunk.length;
  });

  try {
    stream.push(data, false);
  } catch {
    // Ignore a torn or corrupt trailing frame and keep the decoded prefix.
  }

  if (total === 0) return "";

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return Buffer.from(
    merged.buffer,
    merged.byteOffset,
    merged.byteLength,
  ).toString("utf-8");
}

function readSessionContent(sessionFile: SessionFile): string | null {
  try {
    if (!sessionFile.compressed) {
      return readFileSync(sessionFile.filePath, "utf-8");
    }

    return decompressZstd(readFileSync(sessionFile.filePath));
  } catch {
    return null;
  }
}

export class DeepSeekHarnessParser implements IParser {
  readonly tool: ToolDefinition;

  constructor(options: DeepSeekHarnessParserOptions = {}) {
    this.tool = createToolDefinition(
      options.dataDir ?? DEEPSEEK_HARNESS_DATA_DIR,
    );
  }

  async parse(): Promise<ParseResult> {
    const sessionFiles = findSessionFiles(this.tool.dataDir);
    if (sessionFiles.length === 0) {
      return { buckets: [], sessions: [] };
    }

    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];

    for (const sessionFile of sessionFiles) {
      if (sessionFile.version !== SUPPORTED_SESSION_VERSION) {
        logger.debug(
          `deepseek-harness: skipping unsupported session format v${sessionFile.version} at ${sessionFile.filePath}`,
        );
        continue;
      }

      const content = readSessionContent(sessionFile);
      if (!content) continue;

      const lines = content.split("\n");
      let sessionId = sessionFile.filePath;
      let project = "unknown";
      let currentModel = "unknown";

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: DshEvent;
        try {
          event = JSON.parse(line) as DshEvent;
        } catch {
          continue;
        }

        if (event.type === "session") {
          sessionId = event.id || sessionId;
          project = getPathLeaf(event.cwd);
          continue;
        }

        if (typeof event.time !== "number" || !Number.isFinite(event.time)) {
          continue;
        }

        const timestamp = new Date(event.time);
        if (Number.isNaN(timestamp.getTime())) continue;

        if (event.type === "model/selection") {
          currentModel = event.data?.model || currentModel;
          continue;
        }

        if (event.type === "request/header") {
          currentModel = event.data?.header?.config?.model || currentModel;
          continue;
        }

        if (event.type === "user/message") {
          if (event.data?.source?.kind === "user") {
            sessionEvents.push({
              sessionId,
              source: TOOL_ID,
              project,
              timestamp,
              role: "user",
            });
          }
          continue;
        }

        if (event.type !== "assistant/message") continue;

        const model = event.data?.message?.source?.model || currentModel;
        currentModel = model;

        sessionEvents.push({
          sessionId,
          source: TOOL_ID,
          project,
          timestamp,
          role: "assistant",
        });

        const usage = event.data?.usage;
        if (!usage) continue;

        const inputTokens = toSafeNumber(usage.inputTokens);
        const outputTokens = toSafeNumber(usage.outputTokens);
        const cachedTokens =
          toSafeNumber(usage.cacheReadTokens) +
          toSafeNumber(usage.cacheWriteTokens);

        if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
          continue;
        }

        entries.push({
          sessionId,
          source: TOOL_ID,
          model,
          project,
          timestamp,
          inputTokens,
          outputTokens,
          reasoningTokens: 0,
          cachedTokens,
        });
      }
    }

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(sessionEvents, entries),
    };
  }

  isInstalled(): boolean {
    return existsSync(this.tool.dataDir);
  }
}

registerParser(new DeepSeekHarnessParser());
