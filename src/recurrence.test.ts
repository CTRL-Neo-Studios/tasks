import { expect, test } from "vitest";
import { occurrences, type OccurrenceRange, type Recurrence, type Task } from "./index";

const task = (extra: Partial<Task>): Task => ({
  id: "t",
  title: "t",
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});
const starts = (t: Partial<Task>, range: OccurrenceRange) =>
  occurrences(task(t), range).map((o) => o.start);
const rfc = (start: string, recurrence: Recurrence, to = "2001-01-01", extra: Partial<Task> = {}) =>
  starts({ start, recurrence, ...extra }, { from: "1997-01-01", to }).map((s) => s!.slice(0, 10));

// Expected values from RFC 5545 §3.8.5.3 examples.
test.each<[string, string, Recurrence, string[], string?]>([
  [
    "every other week on Mo/We/Fr until Dec 24",
    "1997-09-01T09:00",
    {
      freq: "weekly",
      interval: 2,
      byDay: [{ day: "mo" }, { day: "we" }, { day: "fr" }],
      until: "1997-12-24T00:00",
    },
    [
      "1997-09-01",
      "1997-09-03",
      "1997-09-05",
      "1997-09-15",
      "1997-09-17",
      "1997-09-19",
      "1997-09-29",
    ],
    "1997-10-01",
  ],
  [
    "second-to-last Monday, 6 times",
    "1997-09-22T09:00",
    { freq: "monthly", count: 6, byDay: [{ day: "mo", nth: -2 }] },
    ["1997-09-22", "1997-10-20", "1997-11-17", "1997-12-22", "1998-01-19", "1998-02-16"],
  ],
  [
    "third-to-last day of the month",
    "1997-09-28",
    { freq: "monthly", byMonthDay: [-3] },
    ["1997-09-28", "1997-10-29", "1997-11-28", "1997-12-29", "1998-01-29", "1998-02-26"],
    "1998-03-01",
  ],
  [
    "every 20th Monday of the year",
    "1997-05-19T09:00",
    { freq: "yearly", byDay: [{ day: "mo", nth: 20 }] },
    ["1997-05-19", "1998-05-18", "1999-05-17"],
    "2000-01-01",
  ],
  [
    "every Thursday in March",
    "1997-03-13",
    { freq: "yearly", byMonth: [3], byDay: [{ day: "th" }] },
    [
      "1997-03-13",
      "1997-03-20",
      "1997-03-27",
      "1998-03-05",
      "1998-03-12",
      "1998-03-19",
      "1998-03-26",
    ],
    "1999-01-01",
  ],
])("%s", (_, start, rule, expected, to) => {
  expect(rfc(start, rule, to)).toEqual(expected);
});

test("Friday the 13th, excluding the anchor", () => {
  const rule: Recurrence = { freq: "monthly", byDay: [{ day: "fr" }], byMonthDay: [13] };
  expect(
    rfc("1997-09-02T09:00", rule, "2001-01-01", { excludedDates: ["1997-09-02T09:00"] }),
  ).toEqual(["1998-02-13", "1998-03-13", "1998-11-13", "1999-08-13", "2000-10-13"]);
});

test("the 31st skips shorter months; Feb 29 only in leap years", () => {
  expect(rfc("2026-01-31", { freq: "monthly" }, "2026-06-01")).toEqual([
    "2026-01-31",
    "2026-03-31",
    "2026-05-31",
  ]);
  expect(rfc("2024-02-29", { freq: "yearly" }, "2033-01-01")).toEqual([
    "2024-02-29",
    "2028-02-29",
    "2032-02-29",
  ]);
});

test("count includes excluded occurrences; until is inclusive", () => {
  expect(
    rfc("2026-01-01", { freq: "daily", count: 3 }, "2027-01-01", { excludedDates: ["2026-01-02"] }),
  ).toEqual(["2026-01-01", "2026-01-03"]);
  expect(rfc("2026-01-01", { freq: "daily", until: "2026-01-03" }, "2027-01-01")).toHaveLength(3);
});

test("a rule matching no dates still terminates", () => {
  expect(
    rfc("2026-01-30", { freq: "yearly", byMonth: [2], byMonthDay: [30] }, "2040-01-01"),
  ).toEqual(["2026-01-30"]);
});

test("zoned times keep their wall clock across DST; skipped times move forward", () => {
  const daily = {
    start: "2026-10-24T09:30",
    duration: "PT1H",
    timeZone: "Europe/Berlin",
    recurrence: { freq: "daily" },
  } as const;
  expect(occurrences(task(daily), { from: "2026-10-24", to: "2026-10-26" })).toEqual([
    { start: "2026-10-24T09:30", end: "2026-10-24T10:30" },
    { start: "2026-10-25T09:30", end: "2026-10-25T10:30" }, // DST ended overnight
  ]);
  const gap = task({ start: "2027-03-28T02:30", timeZone: "Europe/Berlin" });
  expect(occurrences(gap, { from: "2027-03-28", to: "2027-03-29" })).toEqual([
    { start: "2027-03-28T03:30" },
  ]);
});

test("the range can be read in another zone", () => {
  const late = task({ start: "2026-11-10T23:30", timeZone: "Europe/Berlin" }); // 17:30 in New York
  expect(occurrences(late, { from: "2026-11-11", to: "2026-11-12" })).toEqual([]);
  expect(
    occurrences(late, { from: "2026-11-10", to: "2026-11-11", timeZone: "America/New_York" }),
  ).toEqual([{ start: "2026-11-10T23:30" }]);
  expect(
    occurrences(late, { from: "2026-11-11", to: "2026-11-12", timeZone: "Asia/Tokyo" }),
  ).toEqual([
    { start: "2026-11-10T23:30" }, // 07:30 on the 11th in Tokyo
  ]);
});

test("all-day spans keep an inclusive end and overlap the range", () => {
  const trip = task({ start: "2026-11-10", end: "2026-11-12", recurrence: { freq: "weekly" } });
  expect(occurrences(trip, { from: "2026-11-12", to: "2026-11-17" })).toEqual([
    { start: "2026-11-10", end: "2026-11-12" },
  ]);
  expect(occurrences(trip, { from: "2026-11-13", to: "2026-11-17" })).toEqual([]);
  const oneDay = task({ start: "2026-11-10", duration: "P1D" });
  expect(occurrences(oneDay, { from: "2026-11-10", to: "2026-11-11" })).toEqual([
    { start: "2026-11-10", end: "2026-11-10" },
  ]);
});

test("due moves with start; due-only todos recur on due", () => {
  const review = task({
    start: "2026-11-02T09:00",
    due: "2026-11-04",
    recurrence: { freq: "weekly" },
  });
  expect(occurrences(review, { from: "2026-11-09", to: "2026-11-16" })).toEqual([
    { start: "2026-11-09T09:00", due: "2026-11-11" },
  ]);
  const rent = task({ due: "2026-11-01", recurrence: { freq: "monthly" } });
  expect(occurrences(rent, { from: "2026-11-15", to: "2027-01-15" })).toEqual([
    { due: "2026-12-01" },
    { due: "2027-01-01" },
  ]);
  expect(occurrences(task({}), { from: "2026-01-01", to: "2027-01-01" })).toEqual([]);
});
