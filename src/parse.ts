import { parse as parseToml, stringify as stringifyToml, TomlDate } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { documentSchema, type TaskDocument } from "./schema";

export type Format = "json" | "yaml" | "toml";

export interface Issue {
  path: (string | number)[];
  message: string;
}

export class TasksFormatError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(
      issues
        .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("\n"),
    );
    this.name = "TasksFormatError";
    this.issues = issues;
  }
}

/**
 * Checks an already-parsed value against the format. Throws `TasksFormatError` with every issue found.
 * Cross-field rules (references, cycles, values) only run once the structure is valid.
 */
export function validate(value: unknown): TaskDocument {
  const result = documentSchema.safeParse(value);
  if (result.success) return result.data;
  throw new TasksFormatError(
    result.error.issues.map((i) => ({
      path: i.path.map((k) => (typeof k === "symbol" ? String(k) : k)),
      message: i.message,
    })),
  );
}

export function parse(text: string, format: Format): TaskDocument {
  let value: unknown;
  try {
    value = decode(text, format);
  } catch (error) {
    throw new TasksFormatError([
      { path: [], message: `invalid ${format}: ${(error as Error).message}` },
    ]);
  }
  return validate(value);
}

/** Validates, then serializes. Unknown keys are written back unchanged. */
export function stringify(doc: TaskDocument, format: Format): string {
  const data = validate(doc);
  switch (format) {
    case "json":
      return `${JSON.stringify(data, null, 2)}\n`;
    case "yaml":
      // 1.1 rules quote anything a YAML 1.1 reader would turn into a date, boolean or number
      // (`2026-11-12`, `yes`); quoted output reads the same under 1.2.
      return stringifyYaml(data, { version: "1.1" });
    case "toml": {
      // smol-toml silently drops nulls; unknown keys from JSON input may hold them.
      const path = findNull(data, []);
      if (path)
        throw new TasksFormatError([
          { path, message: "TOML has no null; remove the key or use JSON/YAML" },
        ]);
      return stringifyToml(data);
    }
  }
}

function decode(text: string, format: Format): unknown {
  switch (format) {
    case "json":
      return JSON.parse(text);
    case "yaml":
      // YAML 1.2 core schema (the default) keeps `2026-11-12` a string rather than a Date.
      return parseYaml(text);
    case "toml":
      return datesToStrings(parseToml(text));
  }
}

/** Unquoted TOML dates parse to TomlDate; the format stores them as strings in the same form. */
function datesToStrings(value: unknown): unknown {
  if (value instanceof TomlDate) return value.toISOString();
  if (Array.isArray(value)) return value.map(datesToStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, datesToStrings(v)]));
  }
  return value;
}

function findNull(value: unknown, path: Issue["path"]): Issue["path"] | undefined {
  if (value === null) return path;
  if (typeof value !== "object") return undefined;
  for (const [k, v] of Object.entries(value)) {
    const found = findNull(v, [...path, Array.isArray(value) ? Number(k) : k]);
    if (found) return found;
  }
  return undefined;
}
