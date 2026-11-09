import { expect, test } from "vitest";
import { fromICS, TasksFormatError, type TaskDocument, toICS } from "./index";

const at = "2026-11-09T10:00:00Z";

const doc: TaskDocument = {
  version: "1.0",
  tasks: [
    {
      id: "standup",
      title: "Standup; daily, short",
      notes: "Line one\nLine two \\ done",
      start: "2026-11-10T09:30",
      duration: "PT15M",
      timeZone: "Europe/Berlin",
      recurrence: {
        freq: "weekly",
        byDay: [{ day: "mo" }, { day: "we" }],
        until: "2026-12-30T09:30",
      },
      excludedDates: ["2026-12-23T09:30"],
      values: { location: "Room 4", tags: ["team", "a,b"] },
      updatedAt: at,
    },
    {
      id: "trip",
      title: "Conference 🎤 ".repeat(8).trim(),
      start: "2026-11-10",
      end: "2026-11-12",
      updatedAt: at,
    },
    {
      id: "invoice",
      title: "Ship invoice",
      due: "2026-11-12",
      completedAt: "2026-11-11T08:00:00Z",
      parentId: "standup",
      dependsOn: ["trip"],
      values: { status: "done", priority: "high", progress: 100 },
      updatedAt: at,
    },
    {
      id: "call",
      title: "Call",
      start: "2026-11-10T08:30",
      end: "2026-11-10T09:00",
      timeZone: "UTC",
      updatedAt: at,
    },
  ],
};

test("round trip keeps everything iCalendar can express", () => {
  expect(fromICS(toICS(doc))).toEqual({ document: doc, dropped: [] });
});

test("output is folded to 75 octets with CRLF and maps kinds and times", () => {
  const ics = toICS(doc);
  const lines = ics.split("\r\n");
  expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  expect(lines).toContain("BEGIN:VEVENT");
  expect(lines).toContain("DTSTART;TZID=Europe/Berlin:20261110T093000");
  expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261230T083000Z"); // UNTIL in UTC
  expect(lines).toContain("DTEND;VALUE=DATE:20261113"); // exclusive in ICS
  expect(lines).toContain("DTSTART:20261110T083000Z");
  expect(lines).toContain("RELATED-TO;RELTYPE=DEPENDS-ON:trip");
});

test("custom statuses export as their category; a VTODO's end becomes DURATION", () => {
  const custom: TaskDocument = {
    version: "1.0",
    fields: [
      {
        id: "status",
        options: [{ id: "shipped", title: "Shipped", category: "done", updatedAt: at }],
      },
    ],
    tasks: [
      {
        id: "x",
        title: "x",
        start: "2026-11-10",
        end: "2026-11-11",
        values: { status: "shipped" },
        updatedAt: at,
      },
    ],
  };
  const task = fromICS(toICS(custom)).document.tasks[0]!;
  expect(task).toMatchObject({ start: "2026-11-10", duration: "P2D", values: { status: "done" } });
});

const google = `BEGIN:VCALENDAR\r
VERSION:2.0\r
X-WR-CALNAME:Work\r
BEGIN:VEVENT\r
UID:a@google.com\r
DTSTAMP:20261109T120000Z\r
LAST-MODIFIED:20261101T080000Z\r
DTSTART;TZID=America/New_York:20261110T090000\r
DTEND;TZID=America/New_York:20261110T100000\r
DUE:20261111T000000Z\r
RRULE:FREQ=MONTHLY;UNTIL=20270101;BYDAY=-1FR\r
SUMMARY:Review\\, with \r
 folding\r
CATEGORIES:Work,Q4\r
BEGIN:VALARM\r
ACTION:DISPLAY\r
DESCRIPTION:Reminder\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:a@google.com\r
RECURRENCE-ID;TZID=America/New_York:20261127T090000\r
DTSTART;TZID=America/New_York:20261127T100000\r
SUMMARY:Review (moved)\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:b\r
DTSTART:20261110T090000\r
RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:c\r
DTSTART;TZID=Pacific Standard Time:20261110T090000\r
END:VEVENT\r
BEGIN:VTODO\r
UID:d\r
SUMMARY:Child\r
RELATED-TO:missing-parent\r
END:VTODO\r
BEGIN:VTODO\r
UID:e\r
SUMMARY:Paint\r
RELATED-TO;RELTYPE=FINISHTOSTART:f\r
END:VTODO\r
BEGIN:VTODO\r
UID:f\r
SUMMARY:Lay carpet\r
END:VTODO\r
END:VCALENDAR\r
`;

test("imports real-world files and lists what it couldn't keep", () => {
  const { document, dropped } = fromICS(google);
  expect(document.tasks.map((t) => t.id)).toEqual(["a@google.com", "d", "e", "f"]);
  expect(document.tasks[0]).toEqual({
    id: "a@google.com",
    title: "Review, with folding",
    start: "2026-11-10T09:00",
    end: "2026-11-10T10:00",
    due: "2026-11-10T19:00", // UTC midnight, read in the event's zone
    timeZone: "America/New_York",
    recurrence: { freq: "monthly", until: "2027-01-01T23:59:59", byDay: [{ day: "fr", nth: -1 }] },
    values: { tags: ["Work", "Q4"] },
    updatedAt: "2026-11-01T08:00:00Z", // LAST-MODIFIED over DTSTAMP
  });
  expect(document.tasks.find((t) => t.id === "f")!.dependsOn).toEqual(["e"]);
  expect(document.tasks.find((t) => t.id === "d")).not.toHaveProperty("parentId");
  expect(dropped.map((d) => d.path)).toEqual([["a@google.com"], ["b"], ["c"], ["d", "RELATED-TO"]]);
  expect(dropped[1]!.message).toBe("RRULE: BYSETPOS isn't supported");
});

test("all-day ends turn inclusive", () => {
  const ics =
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261110\nDTEND;VALUE=DATE:20261111\nEND:VEVENT\nEND:VCALENDAR";
  expect(fromICS(ics).document.tasks[0]).toMatchObject({ start: "2026-11-10", end: "2026-11-10" });
});

test("text that isn't iCalendar is a TasksFormatError", () => {
  expect(() => fromICS("hello")).toThrow(TasksFormatError);
});
