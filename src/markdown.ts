import * as z from "zod";
import { check, decode, encode, TasksFormatError } from "./parse";
import { standaloneTaskSchema, type Task } from "./schema";

/** A Markdown file holding one task: frontmatter `task:` object, body as `task.notes`. */
export interface MarkdownTask {
  /** The body is `notes`, byte for byte. */
  task: Task;
  /** Every other frontmatter key, kept as-is. */
  frontmatter: Record<string, unknown>;
  /** `---` fences YAML, `+++` fences TOML. */
  syntax: "yaml" | "toml";
}

interface Parts {
  syntax: MarkdownTask["syntax"];
  data: string;
  body: string;
}

const CLOSE = { "---": /^---[ \t]*(?:\r?\n|$)/m, "+++": /^\+\+\+[ \t]*(?:\r?\n|$)/m };

/** Frontmatter must open on the first line and close on a line of its own. */
function split(text: string): Parts | undefined {
  const source = text.replace(/^\uFEFF/, "");
  const open = /^(---|\+\+\+)[ \t]*\r?\n/.exec(source);
  if (!open) return undefined;
  const fence = open[1] as keyof typeof CLOSE;
  const rest = source.slice(open[0].length);
  const close = CLOSE[fence].exec(rest);
  if (!close) return undefined;
  return {
    syntax: fence === "---" ? "yaml" : "toml",
    data: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length),
  };
}

const NO_TASK = "frontmatter has no task object";
const frontmatterSchema = z.looseObject(
  { task: z.record(z.string(), z.unknown(), { error: NO_TASK }) },
  { error: NO_TASK },
);

/**
 * True when `text` opens with YAML or TOML frontmatter holding a `task` object. Reads only the frontmatter
 * and never throws; it doesn't validate the task (use `parseMarkdown` for that). Meant for indexing.
 */
export function isTaskFile(text: string): boolean {
  const parts = split(text);
  if (!parts?.data.includes("task")) return false;
  try {
    return frontmatterSchema.safeParse(decode(parts.data, parts.syntax)).success;
  } catch {
    return false;
  }
}

/**
 * Reads a task file. Checks the task's shape and time rules; references (`listId`, `parentId`, `dependsOn`)
 * and `values` are checked once tasks are combined into a document with `validate()`.
 */
export function parseMarkdown(text: string): MarkdownTask {
  const parts = split(text);
  if (!parts) {
    throw new TasksFormatError([
      {
        path: [],
        message:
          "expected frontmatter between --- (YAML) or +++ (TOML) lines at the start of the file",
      },
    ]);
  }
  const { task, ...frontmatter } = check(frontmatterSchema, decode(parts.data, parts.syntax));
  if (Object.hasOwn(task, "notes")) {
    throw new TasksFormatError([
      { path: ["task", "notes"], message: "notes are the Markdown body, not a frontmatter key" },
    ]);
  }
  const withNotes = parts.body === "" ? task : { ...task, notes: parts.body };
  return {
    task: check(standaloneTaskSchema, withNotes, ["task"]),
    frontmatter,
    syntax: parts.syntax,
  };
}

/** Writes frontmatter (other keys first, then `task`) and `task.notes` as the body. Fences use `\n`. */
export function stringifyMarkdown(file: MarkdownTask): string {
  const { notes, ...task } = check(standaloneTaskSchema, file.task, ["task"]);
  const fence = file.syntax === "yaml" ? "---" : "+++";
  const data = encode({ ...file.frontmatter, task }, file.syntax);
  return `${fence}\n${data.endsWith("\n") ? data : `${data}\n`}${fence}\n${notes ?? ""}`;
}
