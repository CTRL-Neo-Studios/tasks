import { parse as parseToml, stringify as stringifyToml, TomlDate } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type * as z from "zod";
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
  return check(documentSchema, value);
}

/** Runs `schema`, turning Zod issues into a `TasksFormatError` with paths under `prefix`. */
export function check<T>(schema: z.ZodType<T>, value: unknown, prefix: Issue["path"] = []): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new TasksFormatError(
    result.error.issues.map((i) => ({
      path: [...prefix, ...i.path.map((k) => (typeof k === "symbol" ? String(k) : k))],
      message: i.message,
    })),
  );
}

export function parse(text: string, format: Format): TaskDocument {
  return validate(decode(text, format));
}

/** Validates, then serializes. Unknown keys are written back unchanged. */
export function stringify(doc: TaskDocument, format: Format): string {
  return encode(validate(doc), format);
}

/** Text → plain data. Syntax errors become `TasksFormatError`; a leading BOM is ignored. */
export function decode(text: string, format: Format): unknown {
  const source = text.replace(/^\uFEFF/, "");
  try {
    switch (format) {
      case "json":
        return JSON.parse(source);
      case "yaml":
        // YAML 1.2 core schema (the default) keeps `2026-11-12` a string rather than a Date.
        return parseYaml(source);
      case "toml":
        return datesToStrings(parseToml(source));
    }
  } catch (error) {
    throw new TasksFormatError([
      { path: [], message: `invalid ${format}: ${(error as Error).message}` },
    ]);
  }
}

/** Plain data → text, no validation. */
export function encode(data: unknown, format: Format): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(data, null, 2)}\n`;
    case "yaml":
      // Quote any string a YAML 1.1 reader (`yes`, `2026-11-12`) or a 1.2 core reader (`0o17`) would turn into
      // another type: 1.1 rules plus the 1.2 core number tags.
      return stringifyYaml(data, {
        version: "1.1",
        customTags: ["intOct", "intHex", "int", "floatExp", "floatNaN", "float"],
      });
    case "toml": {
      // smol-toml silently drops nulls; unknown keys from JSON input may hold them.
      const path = findNull(data, []);
      if (path)
        throw new TasksFormatError([
          { path, message: "TOML has no null; remove the key or use JSON/YAML" },
        ]);
      return stringifyToml(data as Record<string, unknown>);
    }
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
