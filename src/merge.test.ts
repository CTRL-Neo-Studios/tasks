import { expect, test } from "vitest";
import { merge, type Task, type TaskDocument } from "./index";

const t = (minute: number, ms = ""): string =>
  `2026-11-09T10:${String(minute).padStart(2, "0")}:00${ms}Z`;
const task = (id: string, minute: number, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  updatedAt: t(minute),
  ...extra,
});
const doc = (tasks: Task[], extra: Partial<TaskDocument> = {}): TaskDocument => ({
  version: "1.0",
  tasks,
  ...extra,
});
const byId = (d: TaskDocument) => ({
  ...d,
  tasks: d.tasks.toSorted((p, q) => (p.id < q.id ? -1 : 1)),
});

test("newer record wins; records from either side are kept in a-then-b order", () => {
  const a = doc([task("x", 1, { title: "old" }), task("onlyA", 1)]);
  const b = doc([task("onlyB", 1), task("x", 2, { title: "new" })]);
  const { document, repairs } = merge(a, b);
  expect(document.tasks.map((r) => [r.id, r.title])).toEqual([
    ["x", "new"],
    ["onlyA", "onlyA"],
    ["onlyB", "onlyB"],
  ]);
  expect(repairs).toEqual([]);
});

test("timestamps compare as instants, not text", () => {
  const a = doc([task("x", 1, { title: "a" })]);
  const b = doc([{ ...task("x", 1, { title: "b" }), updatedAt: t(1, ".500") }]);
  expect(merge(a, b).document.tasks[0]!.title).toBe("b");
  expect(merge(b, a).document.tasks[0]!.title).toBe("b");
});

test("ties resolve the same from both sides, deletion first", () => {
  const a = doc([task("x", 1, { title: "a" }), task("y", 1, { title: "a" })], { "x-app": 1 });
  const b = doc([task("x", 1, { title: "b" }), task("y", 1, { title: "a", deletedAt: t(1) })], {
    "x-app": 2,
  });
  const ab = merge(a, b).document;
  expect(byId(ab)).toEqual(byId(merge(b, a).document));
  expect(ab.tasks.find((r) => r.id === "y")!.deletedAt).toBe(t(1));
});

test("merging a document with itself changes nothing", () => {
  const a = doc([task("x", 1, { values: { status: "done" } })]);
  expect(merge(a, a)).toEqual({ document: a, repairs: [] });
});

test("options merge one by one; field settings come from the newer definition", () => {
  const option = (id: string) => ({ id, title: id, updatedAt: t(1) });
  const a = doc([], {
    fields: [
      { id: "status", options: [{ ...option("shipped"), category: "done" }] },
      { id: "size", title: "Size", type: "select", options: [option("s")], updatedAt: t(1) },
    ],
  });
  const b = doc([], {
    fields: [
      { id: "status", options: [{ ...option("blocked"), category: "doing" }] },
      {
        id: "size",
        title: "T-shirt size",
        type: "select",
        options: [option("m")],
        updatedAt: t(2),
      },
    ],
  });
  const fields = merge(a, b).document.fields!;
  expect(fields.map((f) => [f.id, f.title, f.options!.map((o) => o.id)])).toEqual([
    ["status", undefined, ["shipped", "blocked"]],
    ["size", "T-shirt size", ["s", "m"]],
  ]);
});

test("a move cycle is broken by undoing the most recent move", () => {
  const a = doc([task("x", 3, { parentId: "y" }), task("y", 1)]);
  const b = doc([task("x", 1), task("y", 2, { parentId: "x" })]);
  const { document, repairs } = merge(a, b);
  expect(document.tasks.map((r) => [r.id, r.parentId])).toEqual([
    ["x", undefined],
    ["y", "x"],
  ]);
  expect(repairs).toEqual([
    { path: ["tasks", 0, "parentId"], message: expect.any(String), removed: "y" },
  ]);
});

test("a dependency cycle drops only the closing link", () => {
  const a = doc([task("x", 3, { dependsOn: ["y", "z"] }), task("y", 1), task("z", 1)]);
  const b = doc([task("x", 1), task("y", 2, { dependsOn: ["x"] }), task("z", 1)]);
  const { document } = merge(a, b);
  expect(document.tasks.map((r) => r.dependsOn)).toEqual([["z"], ["x"], undefined]);
});

test("values that no longer fit their field are removed and reported", () => {
  const estimate = { id: "estimate", title: "Estimate" };
  const a = doc([task("x", 1)], { fields: [{ ...estimate, type: "text", updatedAt: t(2) }] });
  const b = doc([task("x", 3, { values: { estimate: 3, status: "done" } })], {
    fields: [{ ...estimate, type: "number", updatedAt: t(1) }],
  });
  const { document, repairs } = merge(a, b);
  expect(document.tasks[0]!.values).toEqual({ status: "done" });
  expect(repairs).toEqual([
    { path: ["tasks", 0, "values", "estimate"], message: "expected text", removed: 3 },
  ]);
});

test("an option whose category was removed is dropped along with values using it", () => {
  const stage = (categories: string[], minute: number, options: object[] = []) => ({
    id: "stage",
    title: "Stage",
    type: "select" as const,
    categories,
    options: options as never,
    updatedAt: t(minute),
  });
  const a = doc([task("x", 1)], { fields: [stage(["open"], 2)] });
  const b = doc([task("x", 2, { values: { stage: "lost" } })], {
    fields: [
      stage(["open", "closed"], 1, [
        { id: "lost", title: "Lost", category: "closed", updatedAt: t(1) },
      ]),
    ],
  });
  const { document, repairs } = merge(a, b);
  expect(document.fields![0]!.options).toEqual([]);
  expect(document.tasks[0]!.values).toBeUndefined();
  expect(repairs.map((r) => r.path)).toEqual([
    ["fields", 0, "options"],
    ["tasks", 0, "values", "stage"],
  ]);
});

test("the higher minor version wins", () => {
  expect(merge(doc([]), doc([], { version: "1.2" })).document.version).toBe("1.2");
});
