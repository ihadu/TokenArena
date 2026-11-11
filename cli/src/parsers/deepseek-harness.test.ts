import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DeepSeekHarnessParser, decompressZstd } from "./deepseek-harness";

const tempDirs: string[] = [];
const fixturePath = fileURLToPath(
  new URL("./fixtures/deepseek-harness/session.v4.jsonl.zstd", import.meta.url),
);

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSession(
  dataDir: string,
  projectDir: string,
  sessionDir: string,
  fileName: string,
  lines: string[],
): string {
  const dir = join(dataDir, projectDir, sessionDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, fileName);
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

function header(cwd = "/Users/dev/demo-project", id = "session-1"): string {
  return JSON.stringify({
    type: "session",
    version: 4,
    id,
    createdAt: 1_793_322_956_279,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  });
}

function userMessage(time: number, kind = "user"): string {
  return JSON.stringify({
    type: "user/message",
    seq: 0,
    time,
    data: { content: [], source: { kind }, role: "user", id: `u-${kind}` },
  });
}

function assistantMessage(
  time: number,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  model?: string,
): string {
  return JSON.stringify({
    type: "assistant/message",
    seq: 1,
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        content: [],
        source: model
          ? { kind: "model", provider: "deepseek-account", model }
          : { kind: "model" },
        id: "a-1",
      },
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        totalTokens:
          usage.inputTokens +
          usage.outputTokens +
          (usage.cacheReadTokens ?? 0) +
          (usage.cacheWriteTokens ?? 0),
      },
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DeepSeekHarnessParser", () => {
  it("parses DSH session logs into buckets and sessions", async () => {
    const dataDir = makeTempDir("tokenarena-dsh-");
    const timestamp = 1_793_322_960_000;

    writeSession(
      dataDir,
      "--Users-dev-demo-project--",
      "session-1",
      "session.v4.jsonl",
      [
        header(),
        userMessage(timestamp),
        userMessage(timestamp + 100, "time-context"),
        assistantMessage(
          timestamp + 5_000,
          {
            inputTokens: 120,
            outputTokens: 40,
            cacheReadTokens: 30,
            cacheWriteTokens: 5,
          },
          "deepseek-flash",
        ),
        assistantMessage(timestamp + 6_000, {
          inputTokens: 0,
          outputTokens: 0,
        }),
      ],
    );

    const result = await new DeepSeekHarnessParser({ dataDir }).parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "deepseek-harness",
      model: "deepseek-flash",
      project: "demo-project",
      inputTokens: 120,
      outputTokens: 40,
      reasoningTokens: 0,
      cachedTokens: 35,
      totalTokens: 195,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "deepseek-harness",
      project: "demo-project",
      userMessageCount: 1,
      messageCount: 3,
      inputTokens: 120,
      outputTokens: 40,
      cachedTokens: 35,
      totalTokens: 195,
      primaryModel: "deepseek-flash",
    });
  });

  it("falls back to model/selection when the message omits a model", async () => {
    const dataDir = makeTempDir("tokenarena-dsh-");

    writeSession(
      dataDir,
      "--Users-dev-demo-project--",
      "session-2",
      "session.v4.jsonl",
      [
        header(),
        JSON.stringify({
          type: "model/selection",
          seq: 0,
          time: 1_793_322_960_000,
          data: { provider: "deepseek-account", model: "deepseek-pro" },
        }),
        assistantMessage(1_793_322_965_000, {
          inputTokens: 10,
          outputTokens: 5,
        }),
      ],
    );

    const result = await new DeepSeekHarnessParser({ dataDir }).parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.model).toBe("deepseek-pro");
  });

  it("decodes concatenated zstd frames from a real DSH log", async () => {
    const dataDir = makeTempDir("tokenarena-dsh-");
    const sessionDir = join(
      dataDir,
      "--Users-dev-demo-project--",
      "session-fixture",
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "session.v4.jsonl.zstd"),
      readFileSync(fixturePath),
    );

    const result = await new DeepSeekHarnessParser({ dataDir }).parse();

    expect(result.buckets).toHaveLength(2);
    expect(
      result.buckets.reduce((sum, bucket) => sum + bucket.inputTokens, 0),
    ).toBe(150);
    expect(
      result.buckets.reduce((sum, bucket) => sum + bucket.cachedTokens, 0),
    ).toBe(305);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      project: "demo-project",
      userMessageCount: 1,
      messageCount: 3,
    });
    expect(result.sessions[0]?.modelUsages).toHaveLength(2);
  });

  it("keeps the decoded prefix when the trailing frame is torn", () => {
    const bytes = new Uint8Array(readFileSync(fixturePath));
    const truncated = bytes.subarray(0, bytes.length - 20);
    const content = decompressZstd(truncated);

    expect(content).toContain('"type":"session"');
    expect(content).toContain("session-fixture");
  });

  it("skips unsupported session format versions", async () => {
    const dataDir = makeTempDir("tokenarena-dsh-");

    writeSession(
      dataDir,
      "--Users-dev-demo-project--",
      "session-3",
      "session.v3.jsonl",
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-3",
          cwd: "/Users/dev/demo-project",
        }),
        assistantMessage(
          1_793_322_965_000,
          { inputTokens: 10, outputTokens: 5 },
          "deepseek-flash",
        ),
      ],
    );

    const result = await new DeepSeekHarnessParser({ dataDir }).parse();

    expect(result.buckets).toHaveLength(0);
    expect(result.sessions).toHaveLength(0);
  });

  it("prefers the newest session generation in a directory", async () => {
    const dataDir = makeTempDir("tokenarena-dsh-");
    const sessionDir = join(dataDir, "--Users-dev-demo-project--", "session-4");
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "session.v3.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "old",
          cwd: "/Users/dev/demo-project",
        }),
        assistantMessage(1_793_322_965_000, {
          inputTokens: 999,
          outputTokens: 999,
        }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(sessionDir, "session.v4.jsonl"),
      [
        header(),
        assistantMessage(
          1_793_322_965_000,
          { inputTokens: 10, outputTokens: 5 },
          "deepseek-flash",
        ),
      ].join("\n"),
      "utf-8",
    );

    const result = await new DeepSeekHarnessParser({ dataDir }).parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.inputTokens).toBe(10);
  });

  it("reports installation based on the data directory", () => {
    const dataDir = makeTempDir("tokenarena-dsh-");

    expect(new DeepSeekHarnessParser({ dataDir }).isInstalled()).toBe(true);
    rmSync(dataDir, { recursive: true, force: true });
    expect(new DeepSeekHarnessParser({ dataDir }).isInstalled()).toBe(false);
  });
});
