import { describe, expect, test } from "vitest";
import {
  fromICS,
  merge,
  occurrences,
  parse,
  stringify,
  type Task,
  type TaskDocument,
  TasksFormatError,
  toICS,
  validate,
} from "./index";

const at = "2026-11-09T10:00:00Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  updatedAt: at,
  ...extra,
});
const doc = (tasks: Task[], extra: Partial<TaskDocument> = {}): TaskDocument => ({
  version: "1.0",
  tasks,
  ...extra,
});
const formats = ["json", "yaml", "toml"] as const;

describe("text formats", () => {
  // Strings each format's reader could mistake for another type, plus Unicode that breaks naive code.
  const tricky = [
    "yes",
    "no",
    "on",
    "off",
    "null",
    "~",
    "true",
    "1e3",
    "0x1F",
    "0o17",
    ".inf",
    "-.nan",
    "2026-11-12",
    "12:30",
    "1_000",
    "+1",
    "007",
    "",
    " ",
    "#not a comment",
    "key: value",
    "- item",
    "[a]",
    "{a}",
    "'quoted'",
    '"double"',
    "back\\slash",
    "tab\tline\nbreak\r\nCRLF",
    "\u0000nul",
    "\u200Bzero-width",
    "שלום עולם",
    "👩‍👩‍👧‍👦",
    "e\u0301",
    "\uD83D\uDE00",
    "=",
    "[[tasks]]",
    "+++",
    "---",
    "...",
  ];
  const d = doc(
    tricky.map((title, i) =>
      task(`id-${i}`, { title, notes: title, values: { tags: [title || "x"] } }),
    ),
  );

  test.each(formats)(
    "%s keeps strings that look like other types or hold odd Unicode",
    (format) => {
      expect(parse(stringify(d, format), format)).toEqual(d);
    },
  );

  test.each(formats)("%s ignores a byte-order mark", (format) => {
    expect(parse(`\uFEFF${stringify(d, format)}`, format)).toEqual(d);
  });

  test.each(formats)("%s handles 1 MB of notes", (format) => {
    const big = doc([task("a", { notes: "x".repeat(1_000_000) })]);
    expect(parse(stringify(big, format), format)).toEqual(big);
  });

  test("YAML alias bombs fail fast instead of expanding", () => {
    const bomb = ["version: '1.0'", "a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let i = 0; i < 9; i++)
      bomb.push(
        `${"bcdefghij"[i]}: &${"bcdefghij"[i]} [${Array(10).fill(`*${"abcdefghi"[i]}`).join(", ")}]`,
      );
    bomb.push("tasks: []");
    expect(() => parse(bomb.join("\n"), "yaml")).toThrow(TasksFormatError);
  });

  test("YAML duplicate keys and multiple documents are errors", () => {
    expect(() => parse("version: '1.0'\nversion: '1.1'\ntasks: []", "yaml")).toThrow(
      TasksFormatError,
    );
    expect(() =>
      parse("version: '1.0'\ntasks: []\n---\nversion: '1.0'\ntasks: []", "yaml"),
    ).toThrow(TasksFormatError);
  });

  test("TOML integers beyond 2^53 are errors, not silently rounded", () => {
    const text = `version = "1.0"\ntasks = []\n[x-app]\nbig = 9007199254740993`;
    expect(() => parse(text, "toml")).toThrow(TasksFormatError);
  });

  test("__proto__ keys never touch Object.prototype", () => {
    const text = `{"version":"1.0","tasks":[{"id":"a","title":"a","updatedAt":"${at}","values":{"__proto__":"x"},"__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}`;
    const parsed = parse(text, "json");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(parsed.tasks[0])).toBe(Object.prototype);
    expect(parsed.tasks[0]!.values).toEqual({}); // a field can't be named __proto__; the key is dropped
  });

  test("YAML __proto__ and merge keys never touch Object.prototype", () => {
    const text = `version: "1.0"\n__proto__: { polluted: true }\nx: &p { polluted: true }\ny: { <<: *p }\ntasks:\n  - { id: a, title: a, updatedAt: ${at}, __proto__: { polluted: true } }\n`;
    const parsed = parse(text, "yaml");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(parsed.tasks[0])).toBe(Object.prototype);
  });

  test("ordinary YAML anchor reuse passes the alias expansion guard", () => {
    const tasks = Array.from(
      { length: 2000 },
      (_, i) => `  - { id: t${i}, title: T, updatedAt: ${at}, values: { tags: *tags } }`,
    );
    const text = `version: "1.0"\nx-tags: &tags [a, b, c, d, e, f, g, h]\ntasks:\n${tasks.join("\n")}\n`;
    expect(parse(text, "yaml").tasks).toHaveLength(2000);
  });
});

describe("validation", () => {
  test.each([
    ["24:00", "2026-11-10T24:00"],
    ["leap second", "2026-12-31T23:59:60"],
    ["Feb 29 in a common year", "2027-02-29"],
    ["year 10000", "10000-01-01"],
    ["week date", "2026-W46-2"],
    ["ordinal date", "2026-314"],
    ["compact form", "20261110"],
    ["10 fraction digits", "2026-11-10T09:30:00.1234567890"],
    ["trailing Z", "2026-11-10T09:30Z"],
    ["lowercase t", "2026-11-10t09:30"],
  ])("rejects %s", (_, start) => {
    expect(() => validate(doc([task("a", { start })]))).toThrow(TasksFormatError);
  });

  test.each(["P", "PT", "P1Y", "P1M", "-PT1H", "PT1H30", "P1DT", "P1W2D", "PT-1H"])(
    "rejects duration %s",
    (duration) => {
      expect(() => validate(doc([task("a", { start: "2026-11-10T09:30", duration })]))).toThrow(
        TasksFormatError,
      );
    },
  );

  test.each([
    "UTC",
    "Etc/GMT+12",
    "Pacific/Kiritimati",
    "Asia/Kathmandu",
    "America/Argentina/ComodRivadavia",
  ])("accepts time zone %s", (timeZone) => {
    expect(() => validate(doc([task("a", { start: "2026-11-10T09:30", timeZone })]))).not.toThrow();
  });

  test.each(["", "+05:30", "Mars/Olympus_Mons", "Europe/Berlin "])(
    "rejects time zone %j",
    (timeZone) => {
      expect(() => validate(doc([task("a", { start: "2026-11-10T09:30", timeZone })]))).toThrow(
        TasksFormatError,
      );
    },
  );

  test("50,000 tasks in one dependency chain and one parent chain validate", () => {
    const n = 50_000;
    const tasks = Array.from({ length: n }, (_, i) =>
      task(`t${i}`, i === 0 ? {} : { dependsOn: [`t${i - 1}`], parentId: `t${i - 1}` }),
    );
    expect(validate(doc(tasks)).tasks).toHaveLength(n);
    tasks[0]!.dependsOn = [`t${n - 1}`]; // close a 50,000-long loop
    expect(() => validate(doc(tasks))).toThrow("dependsOn cycle");
  });

  test("ids are compared exactly: case, Unicode normalization and whitespace all differ", () => {
    const ids = ["a", "A", "a ", "é", "e\u0301"];
    expect(validate(doc(ids.map((id) => task(id)))).tasks).toHaveLength(5);
  });
});

// Deterministic pseudo-random documents that edit the same records concurrently.
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomDoc(rand: () => number): TaskDocument {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const ids = ["a", "b", "c", "d", "e", "f"];
  const type = pick(["number", "text"] as const);
  const tasks = ids
    .filter(() => rand() < 0.8)
    .map((id) => task(id, { updatedAt: `2026-11-09T10:0${pick([0, 1, 2])}:00Z` }));
  const known = tasks.map((t) => t.id);
  for (const t of tasks) {
    if (rand() < 0.4) t.parentId = pick(known);
    if (rand() < 0.4) t.dependsOn = [...new Set([pick(known), pick(known)])];
    if (rand() < 0.3) t.deletedAt = t.updatedAt;
    if (rand() < 0.5)
      t.values = { estimate: type === "number" ? 3 : "3h", status: pick(["todo", "done", "x"]) };
  }
  const fields = [
    {
      id: "estimate",
      title: "Estimate",
      type,
      updatedAt: `2026-11-09T10:0${pick([0, 1, 2])}:00Z`,
    },
    {
      id: "status",
      options: [{ id: "x", title: "X", category: pick(["done", "doing"]), updatedAt: at }],
    },
  ];
  // Strip whatever makes this side invalid on its own (self-loops and cycles), so only merging can create conflicts.
  for (;;) {
    try {
      return validate(doc(tasks, { fields }));
    } catch (error) {
      const index = (error as TasksFormatError).issues[0]!.path[1] as number;
      delete tasks[index]!.parentId;
      delete tasks[index]!.dependsOn;
    }
  }
}
const sorted = (d: TaskDocument) =>
  JSON.stringify({ ...d, tasks: d.tasks.toSorted((p, q) => (p.id < q.id ? -1 : 1)) });

describe("merge", () => {
  test("500 random concurrent edits: always valid, same content from either side, merging the result again changes nothing", () => {
    const rand = random(42);
    for (let i = 0; i < 500; i++) {
      const [a, b] = [randomDoc(rand), randomDoc(rand)];
      const ab = merge(a, b);
      const ba = merge(b, a);
      expect(sorted(ab.document)).toBe(sorted(ba.document));
      expect(merge(ab.document, ab.document)).toEqual({ document: ab.document, repairs: [] });
      expect(merge(ab.document, a).repairs).toEqual([]);
    }
  });
});

describe("recurrence", () => {
  test("a day that a time zone skipped yields no duplicate (Samoa jumped over 2011-12-30)", () => {
    const daily = task("a", {
      start: "2011-12-28T09:00",
      timeZone: "Pacific/Apia",
      recurrence: { freq: "daily" },
    });
    expect(
      occurrences(daily, { from: "2011-12-28", to: "2012-01-02" }).map((o) => o.start),
    ).toEqual(["2011-12-28T09:00", "2011-12-29T09:00", "2011-12-31T09:00", "2012-01-01T09:00"]);
  });

  test("half-hour DST shift (Lord Howe Island)", () => {
    const t = task("a", {
      start: "2026-10-04T01:45",
      duration: "PT1H",
      timeZone: "Australia/Lord_Howe",
    });
    expect(occurrences(t, { from: "2026-10-04", to: "2026-10-05" })).toEqual([
      { start: "2026-10-04T01:45", end: "2026-10-04T03:15" }, // 02:00 jumped to 02:30
    ]);
  });

  test("100 years of a daily rule stays fast", () => {
    const daily = task("a", { start: "1950-01-01", recurrence: { freq: "daily" } });
    const started = performance.now();
    expect(occurrences(daily, { from: "2049-12-31", to: "2050-01-01" })).toEqual([
      { start: "2049-12-31" },
    ]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("huge intervals and far-future dates", () => {
    const rare = task("a", { start: "2026-01-01", recurrence: { freq: "yearly", interval: 1000 } });
    expect(occurrences(rare, { from: "2026-01-01", to: "9999-12-31" }).map((o) => o.start)).toEqual(
      [
        "2026-01-01",
        "3026-01-01",
        "4026-01-01",
        "5026-01-01",
        "6026-01-01",
        "7026-01-01",
        "8026-01-01",
        "9026-01-01",
      ],
    );
  });

  test("an empty or inverted range yields nothing", () => {
    const t = task("a", { start: "2026-11-10", recurrence: { freq: "daily" } });
    expect(occurrences(t, { from: "2026-11-12", to: "2026-11-12" })).toEqual([]);
    expect(occurrences(t, { from: "2026-11-12", to: "2026-11-01" })).toEqual([]);
  });

  test("every last-weekday-of-month nth (-5…-1) and 5th weekday only in months that have one", () => {
    const fifth = task("a", {
      start: "2026-01-01",
      recurrence: { freq: "monthly", byDay: [{ day: "fr", nth: 5 }] },
    });
    expect(
      occurrences(fifth, { from: "2026-01-02", to: "2027-01-01" }).map((o) => o.start),
    ).toEqual(["2026-01-30", "2026-05-29", "2026-07-31", "2026-10-30"]);
  });
});

describe("iCalendar", () => {
  test("survives sloppy real-world input", () => {
    const ics = [
      "begin:vcalendar", // lowercase names
      "BEGIN:VEVENT",
      "UID:x",
      'DTSTART;TZID="America/New_York";X-FOO="a:b;c":20261110T090000', // quoted params holding : and ;
      "SUMMARY:tab\r\n\tcontinued and \\Nnewline", // tab continuation, \N
      "CATEGORIES:a\\,b,c", // escaped comma inside a value
      "CATEGORIES:c,d", // repeated property, duplicate value
      "X-UNKNOWN;FOO=bar:ignored",
      "PRIORITY:0",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "BEGIN:VEVENT", // no UID
      "SUMMARY:orphan",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:y",
      "DTSTART;TZID=/mozilla.org/20050126_1/Europe/Berlin:20261110T090000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:z",
      "DTSTART:2026-11-10", // dashes aren't iCalendar
      "END:VEVENT",
      // no END:VCALENDAR
    ].join("\n");
    const { document, dropped } = fromICS(ics);
    expect(document.tasks).toEqual([
      {
        id: "x",
        title: "tabcontinued and \nnewline",
        start: "2026-11-10T09:00",
        timeZone: "America/New_York",
        values: { tags: ["a,b", "c", "d"] },
        updatedAt: "1970-01-01T00:00:00Z",
      },
    ]);
    expect(dropped.map((d) => d.path[0])).toEqual(["VEVENT #2", "y", "z"]);
  });

  test("an empty calendar is an empty document", () => {
    expect(fromICS("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toEqual({
      document: doc([]),
      dropped: [],
    });
  });

  test("a 10,000-character description folds and unfolds intact", () => {
    const notes = "🎉 long, text; with \\ escapes\n".repeat(400);
    const d = doc([task("a", { notes })]);
    expect(fromICS(toICS(d)).document).toEqual(d);
  });
});
