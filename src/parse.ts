import { documentSchema, type TaskDocument } from "./schema";

export type Format = "json";

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
    value = JSON.parse(text);
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
  }
}
