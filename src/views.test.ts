import { expect, test } from "vitest";
import { resolveFields, type Task, type TaskDocument, type View, viewTasks } from "./index";

const at = "2026-11-09T10:00:00Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  updatedAt: at,
  ...extra,
});
const doc: TaskDocument = {
  version: "1.1",
  lists: [
    { id: "work", title: "Work", updatedAt: at },
    { id: "acme", title: "Acme", parentId: "work", updatedAt: at },
    { id: "home", title: "Home", updatedAt: at },
  ],
  fields: [
    {
      id: "priority",
      options: [{ id: "urgent", title: "Urgent", category: "high", updatedAt: at }],
    },
  ],
  tasks: [
    task("a", { listId: "acme", due: "2026-11-12", values: { priority: "high" } }),
    task("b", { listId: "home", due: "2026-11-10T09:00", values: { priority: "urgent" } }),
    task("c", { listId: "work", values: { priority: "low", status: "done" } }),
    task("d", { listId: "work", due: "2026-11-10", deletedAt: at }),
    task("e", { due: "2026-11-10", starred: true }),
    task("f", { listId: "work", title: "item 10" }),
    task("g", { listId: "work", title: "item 9" }),
  ],
};
const fields = resolveFields(doc);
const ids = (view: Partial<View>) =>
  viewTasks(doc, { id: "v", title: "V", type: "list", updatedAt: at, ...view }, fields).map(
    (t) => t.id,
  );

test("no sort: document order, deleted tasks hidden", () => {
  expect(ids({})).toEqual(["a", "b", "c", "e", "f", "g"]);
});

test("lists include their nested lists; openOnly hides done", () => {
  expect(ids({ listIds: ["work"] })).toEqual(["a", "c", "f", "g"]);
  expect(ids({ listIds: ["work"], openOnly: true })).toEqual(["a", "f", "g"]);
});

test("times sort as written, a date before times on its day; missing values last both ways", () => {
  expect(ids({ sortBy: "due" })).toEqual(["e", "b", "a", "c", "f", "g"]);
  expect(ids({ sortBy: "due", sortDescending: true })).toEqual(["a", "b", "e", "c", "f", "g"]);
});

test("selects sort by option order, added options after the built-in ones", () => {
  expect(ids({ sortBy: "values.priority", sortDescending: true })).toEqual([
    "b",
    "a",
    "c",
    "e",
    "f",
    "g",
  ]);
});

test("titles sort as words, numbers by value", () => {
  expect(ids({ listIds: ["work"], sortBy: "title" }).slice(-2)).toEqual(["g", "f"]);
});

test("starred: absent is not starred", () => {
  expect(ids({ sortBy: "starred", sortDescending: true })[0]).toBe("e");
});
