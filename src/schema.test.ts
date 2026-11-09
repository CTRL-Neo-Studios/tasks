import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  kindOf,
  parse,
  resolveFields,
  stringify,
  TasksFormatError,
  validate,
  type TaskDocument,
} from "./index";

const at = "2026-11-09T10:00:00Z";

const doc = (): TaskDocument => ({
  version: "1.0",
  lists: [
    { id: "clients", title: "Clients", updatedAt: at },
    { id: "acme", title: "Acme", parentId: "clients", color: "#3b82f6", updatedAt: at },
  ],
  fields: [
    {
      id: "status",
      options: [
        { id: "done", title: "Finished", updatedAt: at },
        { id: "shipped", title: "Shipped", category: "done", updatedAt: at },
      ],
    },
    {
      id: "stage",
      title: "Stage",
      type: "select",
      categories: ["lead", "closed"],
      options: [{ id: "proposal", title: "Proposal", category: "lead", updatedAt: at }],
      updatedAt: at,
    },
    { id: "estimate", title: "Estimate", type: "number", min: 0, updatedAt: at },
  ],
  tasks: [
    {
      id: "invoice",
      title: "Ship invoice",
      listId: "acme",
      due: "2026-11-12",
      values: {
        status: "shipped",
        priority: "high",
        tags: ["billing"],
        estimate: 2,
        stage: "proposal",
      },
      updatedAt: at,
    },
    {
      id: "standup",
      title: "Standup",
      start: "2026-11-10T09:30",
      duration: "PT15M",
      timeZone: "Europe/Berlin",
      recurrence: { freq: "monthly", byDay: [{ day: "tu", nth: 2 }], until: "2026-12-31T00:00" },
      excludedDates: ["2026-12-08T09:30"],
      dependsOn: ["invoice"],
      updatedAt: at,
    },
  ],
});

function issuesOf(change: (d: TaskDocument) => void): string[] {
  const d = doc();
  change(d);
  try {
    validate(d);
  } catch (error) {
    if (error instanceof TasksFormatError)
      return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw error;
  }
  return [];
}

test("accepts a document using every feature", () => {
  expect(issuesOf(() => {})).toEqual([]);
});

const task = (d: TaskDocument, i = 1) => d.tasks[i]!;
describe("rejects", () => {
  const cases: [string, (d: TaskDocument) => void, string][] = [
    ["future major version", (d) => (d.version = "2.0"), "version: unsupported version"],
    ["duplicate task id", (d) => (task(d).id = "invoice"), 'tasks.1.id: duplicate id "invoice"'],
    ["unknown list", (d) => (task(d).listId = "nope"), 'tasks.1.listId: unknown list "nope"'],
    ["list cycle", (d) => (d.lists![0]!.parentId = "acme"), "parentId cycle"],
    ["dependency cycle", (d) => (task(d, 0).dependsOn = ["standup"]), "dependsOn cycle"],
    ["self parent", (d) => (task(d).parentId = "standup"), "tasks.1.parentId:"],
    ["impossible date", (d) => (task(d, 0).due = "2026-02-29"), "tasks.0.due: expected a date"],
    ["offset in local time", (d) => (task(d).start = "2026-11-10T09:30+01:00"), "tasks.1.start:"],
    [
      "non-UTC timestamp",
      (d) => (task(d).updatedAt = "2026-11-09T10:00:00+01:00"),
      "tasks.1.updatedAt:",
    ],
    ["offset as time zone", (d) => (task(d).timeZone = "+01:00"), "tasks.1.timeZone:"],
    ["bad color", (d) => (d.lists![0]!.color = "red"), "lists.0.color: expected a #rrggbb color"],
    [
      "end and duration",
      (d) => (task(d).end = "2026-11-10T10:00"),
      "use end or duration, not both",
    ],
    [
      "end before start (seconds vs none)",
      (d) => setSpan(d, "2026-11-10T09:30:00.5", "2026-11-10T09:30"),
      "end is before start",
    ],
    [
      "date end on date-time start",
      (d) => setSpan(d, "2026-11-10T09:30", "2026-11-11"),
      "both dates or both date-times",
    ],
    [
      "hour duration on all-day",
      (d) => (task(d).start = "2026-11-10"),
      "need a duration in days or weeks",
    ],
    [
      "unknown recurrence key",
      (d) => Object.assign(task(d).recurrence!, { bySetPos: [1] }),
      "tasks.1.recurrence:",
    ],
    ["nth on weekly", (d) => (task(d).recurrence!.freq = "weekly"), "nth needs monthly or yearly"],
    ["count with until", (d) => (task(d).recurrence!.count = 3), "use count or until, not both"],
    [
      "excluded date form",
      (d) => (task(d).excludedDates = ["2026-12-08"]),
      "tasks.1.excludedDates.0: must match start",
    ],
    ["exclusions without rule", (d) => delete task(d).recurrence, "excludedDates needs recurrence"],
    [
      "undefined field",
      (d) => (task(d, 0).values!["estimat"] = 1),
      'values.estimat: unknown field "estimat"',
    ],
    ["unknown option", (d) => (task(d, 0).values!["status"] = "nope"), 'unknown option "nope"'],
    ["number below min", (d) => (task(d, 0).values!["estimate"] = -1), "must be at least 0"],
    ["built-in range", (d) => (task(d, 0).values!["progress"] = 101), "must be at most 100"],
    [
      "changing built-in field",
      (d) => (d.fields![0]!.type = "text"),
      'built-in field "status" is locked',
    ],
    [
      "recategorizing built-in option",
      (d) => (d.fields![0]!.options![0]!.category = "todo"),
      'always "done"',
    ],
    [
      "deleting built-in option",
      (d) => (d.fields![0]!.options![0]!.deletedAt = at),
      "can't be deleted",
    ],
    [
      "custom status category",
      (d) => (d.fields![0]!.options![1]!.category = "archived"),
      "expected one of: todo, doing, done",
    ],
    [
      "category on uncategorized field",
      (d) =>
        d.fields!.push({
          id: "tags",
          options: [{ id: "x", title: "X", category: "a", updatedAt: at }],
        }),
      'field "tags" has no categories',
    ],
    [
      "options on number field",
      (d) => (d.fields![2]!.options = []),
      'only select fields can have "options"',
    ],
    ["custom field without type", (d) => delete d.fields![1]!.type, 'custom fields need "type"'],
    [
      "prototype key as field id",
      (d) => (task(d, 0).values!["constructor"] = "x"),
      'unknown field "constructor"',
    ],
  ];
  test.each(cases)("%s", (_, change, expected) => {
    expect(issuesOf(change).join("\n")).toContain(expected);
  });
});

function setSpan(d: TaskDocument, start: string, end: string): void {
  const t = d.tasks[1]!;
  delete t.duration;
  delete t.recurrence;
  delete t.excludedDates;
  Object.assign(t, { start, end });
}

test("deleted options and fields stay valid targets", () => {
  expect(
    issuesOf((d) => {
      d.fields![1]!.deletedAt = at;
      d.fields![0]!.options![1]!.deletedAt = at;
    }),
  ).toEqual([]);
});

test("resolveFields layers document options over built-ins", () => {
  const status = resolveFields(doc())["status"]!;
  expect(status.options.map((o) => [o.id, o.title, o.category])).toEqual([
    ["todo", "To do", "todo"],
    ["doing", "In progress", "doing"],
    ["done", "Finished", "done"],
    ["cancelled", "Cancelled", "cancelled"],
    ["shipped", "Shipped", "done"],
  ]);
  expect(resolveFields({})["status"]!.options[2]!.title).toBe("Done"); // built-ins not mutated
});

test("kindOf", () => {
  expect(kindOf({ start: "2026-11-10", end: "2026-11-11" })).toBe("span");
  expect(kindOf({ start: "2026-11-10", duration: "P1D" })).toBe("span");
  expect(kindOf({ start: "2026-11-10" })).toBe("moment");
  expect(kindOf({})).toBe("todo");
});

describe.each(["json", "yaml", "toml"] as const)("%s", (format) => {
  test("round trip keeps every value and unknown keys", () => {
    const d = { ...doc(), "x-app": { theme: "dark" } };
    d.tasks[0]!["x-sort"] = 3;
    d.tasks[0]!.title = "yes"; // a boolean in YAML 1.1 if unquoted
    expect(parse(stringify(d, format), format)).toEqual(d);
  });

  test("syntax errors are TasksFormatError", () => {
    expect(() => parse("{[", format)).toThrow(TasksFormatError);
  });
});

test("YAML output reads the same in YAML 1.1 parsers", () => {
  const d = doc();
  d.tasks[0]!.title = "no";
  expect(parseYaml(stringify(d, "yaml"), { version: "1.1" })).toEqual(d);
});

test("hand-written YAML keeps unquoted dates as strings", () => {
  const d = parse(
    `version: "1.0"
tasks:
  - id: a
    title: Standup
    start: 2026-11-10T09:30
    duration: PT15M
    updatedAt: 2026-11-09T10:00:00Z
`,
    "yaml",
  );
  expect(d.tasks[0]).toMatchObject({
    start: "2026-11-10T09:30",
    updatedAt: "2026-11-09T10:00:00Z",
  });
});

test("hand-written TOML accepts native dates", () => {
  const d = parse(
    `version = "1.0"

[[tasks]]
id = "a"
title = "Standup"
start = 2026-11-10T09:30:00
due = 2026-11-12
updatedAt = 2026-11-09T10:00:00Z

[tasks.values]
status = "done"
`,
    "toml",
  );
  expect(d.tasks[0]).toMatchObject({
    start: "2026-11-10T09:30:00.000",
    due: "2026-11-12",
    updatedAt: "2026-11-09T10:00:00.000Z",
    values: { status: "done" },
  });
});

test("TOML refuses nulls instead of dropping them", () => {
  const d = doc();
  d.tasks[1]!["x-color"] = null;
  expect(() => stringify(d, "toml")).toThrow("tasks.1.x-color: TOML has no null");
});
