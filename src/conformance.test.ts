import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { fromICS, type Issue, parse, parseMarkdown, TasksFormatError } from "./index";

// Runs the shared cases in conformance/; a Rust (or any) implementation should pass the same files.
interface Case {
  name: string;
  format: "json" | "yaml" | "toml" | "markdown" | "ics";
  input: string;
  issues?: Issue["path"][];
  dropped?: Issue["path"][];
  expect?: unknown;
}

const load = (file: string): Case[] =>
  parseYaml(readFileSync(new URL(`../conformance/${file}`, import.meta.url), "utf8"));

function read(c: Case): { value?: unknown; issues?: Issue["path"][]; dropped?: Issue["path"][] } {
  try {
    if (c.format === "markdown") return { value: parseMarkdown(c.input) };
    if (c.format === "ics") {
      const { document, dropped } = fromICS(c.input);
      return { value: document, dropped: dropped.map((d) => d.path) };
    }
    return { value: parse(c.input, c.format) };
  } catch (error) {
    if (error instanceof TasksFormatError) return { issues: error.issues.map((i) => i.path) };
    throw error;
  }
}

// A thrown TasksFormatError always has at least one issue, so empty lists mean "none of this kind".
const sorted = (paths: Issue["path"][] = []): string[] =>
  paths.map((p) => JSON.stringify(p)).toSorted();

describe("errors", () => {
  test.each(load("errors.yaml"))("$name", (c) => {
    const result = read(c);
    expect({ issues: sorted(result.issues), dropped: sorted(result.dropped) }).toEqual({
      issues: sorted(c.issues),
      dropped: sorted(c.dropped),
    });
  });
});

describe("valid", () => {
  test.each(load("valid.yaml"))("$name", (c) => {
    const result = read(c);
    expect(result.issues).toBeUndefined();
    expect(result.dropped ?? []).toEqual([]);
    expect(result.value).toEqual(c.expect);
  });
});
