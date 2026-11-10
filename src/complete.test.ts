import { expect, test } from "vitest";
import { completeTask, occurrences, type Task, validate } from "./index";

const at = "2026-11-09T10:00:00Z";
const done = "2026-11-12T08:00:00Z";
const task = (extra: Partial<Task>): Task => ({ id: "t", title: "t", updatedAt: at, ...extra });

test("a one-off task is marked done", () => {
  expect(
    completeTask(task({ due: "2026-11-12", values: { status: "doing", tags: ["a"] } }), done),
  ).toEqual({
    ...task({ due: "2026-11-12" }),
    values: { status: "done", tags: ["a"] },
    completedAt: done,
    updatedAt: done,
  });
});

test("a recurring todo moves to its next occurrence and resets status and progress", () => {
  const rent = task({
    due: "2026-11-01",
    recurrence: { freq: "monthly" },
    values: { status: "done", progress: 100 },
  });
  const next = completeTask(rent, done);
  expect(next).toEqual({
    ...rent,
    due: "2026-12-01",
    values: { status: "todo", progress: 0 },
    updatedAt: done,
  });
  expect(rent.due).toBe("2026-11-01"); // input untouched
  expect(next).not.toHaveProperty("completedAt");
});

test("start, end and due all move by their offsets; all-day ends stay inclusive", () => {
  const trip = task({
    start: "2026-11-10",
    end: "2026-11-12",
    due: "2026-11-09",
    recurrence: { freq: "weekly" },
  });
  expect(completeTask(trip, done)).toMatchObject({
    start: "2026-11-17",
    end: "2026-11-19",
    due: "2026-11-16",
  });
  const call = task({
    start: "2026-11-10T09:30",
    end: "2026-11-10T10:15",
    recurrence: { freq: "daily" },
  });
  expect(completeTask(call, done)).toMatchObject({
    start: "2026-11-11T09:30",
    end: "2026-11-11T10:15",
  });
});

test("excluded dates are skipped, and count drops by every occurrence used up", () => {
  const t = task({
    due: "2026-11-01",
    recurrence: { freq: "daily", count: 5 },
    excludedDates: ["2026-11-02", "2026-11-03"],
  });
  const next = completeTask(t, done);
  expect(next).toMatchObject({ due: "2026-11-04", recurrence: { freq: "daily", count: 2 } });
  // The remaining series is the same before and after.
  const range = { from: "2026-11-04", to: "2027-01-01" };
  expect(occurrences(next, range)).toEqual(occurrences(t, range));
});

test("the last occurrence completes the task (count, until, and excluded tail)", () => {
  for (const recurrence of [
    { freq: "daily", count: 1 },
    { freq: "daily", until: "2026-11-01" },
  ] as const) {
    expect(completeTask(task({ due: "2026-11-01", recurrence }), done)).toMatchObject({
      due: "2026-11-01",
      values: { status: "done" },
      completedAt: done,
    });
  }
  const tail = task({
    due: "2026-11-01",
    recurrence: { freq: "daily", count: 2 },
    excludedDates: ["2026-11-02"],
  });
  expect(completeTask(tail, done).values).toEqual({ status: "done" });
});

test("a next occurrence in a DST gap keeps the series' wall-clock time", () => {
  // 02:30 doesn't exist on 2027-03-28 in Berlin; the series must stay at 02:30, not drift to 03:30.
  let t = task({
    start: "2027-03-27T02:30",
    timeZone: "Europe/Berlin",
    recurrence: { freq: "daily" },
  });
  t = completeTask(t, done);
  expect(t.start).toBe("2027-03-28T02:30");
  expect(occurrences(t, { from: "2027-03-28", to: "2027-03-29" })).toEqual([
    { start: "2027-03-28T03:30" },
  ]);
  expect(completeTask(t, done).start).toBe("2027-03-29T02:30");
});

test("completing every occurrence of a series walks it exactly, and every result stays valid", () => {
  const second = { day: "tu", nth: 2 } as const;
  let t = task({
    start: "2026-11-10T09:00",
    duration: "PT1H",
    recurrence: { freq: "monthly", byDay: [second], count: 6 },
  });
  const expected = occurrences(t, { from: "2026-01-01", to: "2028-01-01" }).map((o) => o.start);
  const seen: (string | undefined)[] = [];
  for (let i = 0; i < 10 && !t.completedAt; i++) {
    seen.push(t.start);
    t = completeTask(t, done);
    validate({ version: "1.0", tasks: [t] });
  }
  expect(seen).toEqual(expected);
  expect(t.values?.["status"]).toBe("done");
});
