import { expect, test } from "vitest";
import { isTaskFile, parseMarkdown, stringifyMarkdown, TasksFormatError, validate } from "./index";

const yamlFile = `---
aliases: [invoice]
tags: [obsidian-tag] # the note's tags, not the task's
task:
  id: invoice
  title: Ship invoice
  due: 2026-11-12
  values: { status: done, tags: [billing] }
  updatedAt: 2026-11-09T10:00:00Z
---

# Ship invoice

- [ ] attach PDF
---
Text under a horizontal rule.   
`;

test("YAML frontmatter: task under task:, other keys kept, body becomes notes", () => {
  const file = parseMarkdown(yamlFile);
  expect(file.syntax).toBe("yaml");
  expect(file.frontmatter).toEqual({ aliases: ["invoice"], tags: ["obsidian-tag"] });
  expect(file.task).toMatchObject({
    id: "invoice",
    due: "2026-11-12",
    values: { status: "done", tags: ["billing"] },
  });
  expect(file.task.notes).toBe(yamlFile.slice(yamlFile.indexOf("\n---\n") + 5)); // byte-exact, rule included
});

test("round trip keeps the body byte-for-byte and the frontmatter's data", () => {
  const file = parseMarkdown(yamlFile);
  const again = parseMarkdown(stringifyMarkdown(file));
  expect(again).toEqual(file);
  expect(stringifyMarkdown(again)).toBe(stringifyMarkdown(file));
});

test("TOML frontmatter with native dates", () => {
  const toml = `+++
title = "page title"

[task]
id = "standup"
title = "Standup"
start = 2026-11-10T09:30:00
duration = "PT15M"
updatedAt = 2026-11-09T10:00:00Z
+++
Notes`;
  const file = parseMarkdown(toml);
  expect(file).toMatchObject({
    syntax: "toml",
    frontmatter: { title: "page title" },
    task: { start: "2026-11-10T09:30:00.000", notes: "Notes" },
  });
  expect(parseMarkdown(stringifyMarkdown(file))).toEqual(file);
});

test("BOM, CRLF and a body-less file", () => {
  const file = parseMarkdown(
    "\uFEFF---\r\ntask:\r\n  id: a\r\n  title: A\r\n  updatedAt: 2026-11-09T10:00:00Z\r\n---\r\n",
  );
  expect(file.task).toEqual({ id: "a", title: "A", updatedAt: "2026-11-09T10:00:00Z" });
  // Keys are written in schema order: id, updatedAt, then the rest.
  expect(stringifyMarkdown(file)).toBe(
    '---\ntask:\n  id: a\n  updatedAt: "2026-11-09T10:00:00Z"\n  title: A\n---\n',
  );
});

test.each([
  ["no frontmatter", "# Just a note\n", "expected frontmatter"],
  ["frontmatter not on the first line", "\n---\ntask: {}\n---\n", "expected frontmatter"],
  ["unclosed frontmatter", "---\ntask:\n  id: a\n", "expected frontmatter"],
  ["fence with trailing text", "---\ntask: {}\n--- not a fence\n", "expected frontmatter"],
  ["empty frontmatter", "---\n---\nbody", "frontmatter has no task object"],
  ["task isn't an object", "---\ntask: buy milk\n---\n", "frontmatter has no task object"],
  ["task is a list", "---\ntask: [a]\n---\n", "frontmatter has no task object"],
  [
    "notes in frontmatter",
    "---\ntask: { id: a, title: A, notes: x, updatedAt: 2026-11-09T10:00:00Z }\n---\n",
    "task.notes: notes are the Markdown body",
  ],
  ["broken YAML", "---\ntask: [\n---\n", "invalid yaml"],
  [
    "time rule broken",
    "---\ntask: { id: a, title: A, end: 2026-11-10, updatedAt: 2026-11-09T10:00:00Z }\n---\n",
    "task.end: end needs start",
  ],
])("rejects %s", (_, text, message) => {
  expect(() => parseMarkdown(text)).toThrow(TasksFormatError);
  expect(() => parseMarkdown(text)).toThrow(message);
});

test("references and values are checked once files form a document", () => {
  const a = parseMarkdown(
    "---\ntask: { id: a, title: A, parentId: b, values: { estimate: 3 }, updatedAt: 2026-11-09T10:00:00Z }\n---\n",
  );
  expect(() => validate({ version: "1.0", tasks: [a.task] })).toThrow(
    /unknown task "b"[\s\S]*unknown field "estimate"/,
  );
});

test.each([
  ["a task file", yamlFile, true],
  ["TOML task file", "+++\n[task]\nid = 'a'\n+++\n", true],
  ["an invalid task still counts", "---\ntask: { title: 3 }\n---\n", true],
  ["plain note", "---\ntitle: Groceries\ntags: [task]\n---\n- milk\n", false],
  ["task key nested deeper", "---\nmeta:\n  task: { id: a }\n---\n", false],
  ["task is a string", "---\ntask: buy milk\n---\n", false],
  ["no frontmatter", "task: { id: a }\n", false],
  ["broken frontmatter", "---\ntask: [\n---\n", false],
  ["empty file", "", false],
])("isTaskFile: %s", (_, text, expected) => {
  expect(isTaskFile(text)).toBe(expected);
});
