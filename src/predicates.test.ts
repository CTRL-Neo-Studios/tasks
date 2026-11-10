import { describe, expect, test } from "vitest";
import {
  blockers,
  isComplete,
  isOpen,
  isOverdue,
  priorityOf,
  resolveFields,
  statusOf,
  type Task,
} from "./index";

const at = "2026-11-09T10:00:00Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  updatedAt: at,
  ...extra,
});
const fields = resolveFields({
  fields: [
    {
      id: "status",
      options: [
        { id: "shipped", title: "Shipped", category: "done", updatedAt: at },
        { id: "blocked", title: "Blocked", category: "doing", updatedAt: at },
        { id: "old", title: "Old", category: "done", updatedAt: at, deletedAt: at },
      ],
    },
    { id: "priority", options: [{ id: "p0", title: "P0", category: "high", updatedAt: at }] },
  ],
});

test("custom options read as their category; missing status is todo, missing priority is none", () => {
  expect(statusOf(task("a", { values: { status: "shipped" } }), fields)).toBe("done");
  expect(statusOf(task("a", { values: { status: "old" } }), fields)).toBe("done"); // deleted options still mean something
  expect(statusOf(task("a"), fields)).toBe("todo");
  expect(priorityOf(task("a", { values: { priority: "p0" } }), fields)).toBe("high");
  expect(priorityOf(task("a"), fields)).toBeUndefined();
});

test.each([
  [{ values: { status: "shipped" } }, true, false],
  [{ values: { status: "blocked" } }, false, true],
  [{ values: { status: "cancelled" } }, false, false],
  [{}, false, true],
  [{ deletedAt: at }, false, false],
])("%j: complete %s, open %s", (extra, complete, open) => {
  const t = task("a", extra as Partial<Task>);
  expect([isComplete(t, fields), isOpen(t, fields)]).toEqual([complete, open]);
});

describe("isOverdue", () => {
  const ny = { timeZone: "America/New_York" };

  test("an all-day due date is overdue only once its whole day has passed for the viewer", () => {
    const t = task("a", { due: "2026-11-10" });
    expect(isOverdue(t, fields, { ...ny, now: "2026-11-11T04:59:00Z" })).toBe(false); // 23:59 on the 10th in New York
    expect(isOverdue(t, fields, { ...ny, now: "2026-11-11T05:00:00Z" })).toBe(true); // 00:00 on the 11th
    expect(isOverdue(t, fields, { timeZone: "Asia/Tokyo", now: "2026-11-10T15:00:00Z" })).toBe(
      true,
    ); // already the 11th in Tokyo
  });

  test("a timed due is read in the task's zone, otherwise the viewer's", () => {
    const berlin = task("a", { due: "2026-11-10T09:00", timeZone: "Europe/Berlin" });
    expect(isOverdue(berlin, fields, { ...ny, now: "2026-11-10T07:59:00Z" })).toBe(false);
    expect(isOverdue(berlin, fields, { ...ny, now: "2026-11-10T08:01:00Z" })).toBe(true);
    const floating = task("a", { due: "2026-11-10T09:00" });
    expect(isOverdue(floating, fields, { ...ny, now: "2026-11-10T13:59:00Z" })).toBe(false);
    expect(isOverdue(floating, fields, { ...ny, now: new Date("2026-11-10T14:01:00Z") })).toBe(
      true,
    );
  });

  test("done, cancelled, deleted and undated tasks are never overdue", () => {
    const now = "2030-01-01T00:00:00Z";
    for (const extra of [
      { values: { status: "shipped" } },
      { values: { status: "cancelled" } },
      { deletedAt: at },
    ]) {
      expect(isOverdue(task("a", { due: "2026-11-10", ...extra }), fields, { now })).toBe(false);
    }
    expect(isOverdue(task("a", { start: "2026-11-10" }), fields, { now })).toBe(false);
  });
});

test("blockers are the unfinished dependencies", () => {
  const tasks = [
    task("paint", { values: { status: "doing" } }),
    task("wire", { values: { status: "shipped" } }),
    task("permit", { values: { status: "cancelled" } }),
    task("gone", { deletedAt: at }),
    task("order"),
    task("carpet", { dependsOn: ["paint", "wire", "permit", "gone", "order"] }),
  ];
  expect(blockers(tasks[5]!, tasks, fields).map((t) => t.id)).toEqual(["paint", "order"]);
  expect(blockers(tasks[0]!, tasks, fields)).toEqual([]);
});
