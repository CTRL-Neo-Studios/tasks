import { Temporal } from "temporal-polyfill";
import { type Issue, TasksFormatError, validate } from "./parse";
import {
  type FieldValue,
  type Recurrence,
  resolveFields,
  type Task,
  type TaskDocument,
  type Weekday,
} from "./schema";

/** `dropped` lists what couldn't be carried over: whole components, single properties, or broken references. */
export interface ImportResult {
  document: TaskDocument;
  dropped: Issue[];
}

const STATUS_TO_ICS: Record<string, string> = {
  todo: "NEEDS-ACTION",
  doing: "IN-PROCESS",
  done: "COMPLETED",
  cancelled: "CANCELLED",
};
const STATUS_FROM_ICS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_TO_ICS).map(([k, v]) => [v, k]),
);
const PRIORITY_TO_ICS: Record<string, number> = { high: 1, medium: 5, low: 9 };

// --- Export ---

/**
 * One VCALENDAR with a VTODO or VEVENT per task that isn't deleted. A task becomes a VEVENT when it has
 * `start`, no `due`, and no status other than cancelled. Time zones are referenced by IANA name without
 * VTIMEZONE blocks (RFC 7809), which Apple, Google and Outlook.com accept. See SPEC.md for what is lost.
 */
export function toICS(doc: TaskDocument): string {
  const valid = validate(doc);
  const fields = resolveFields(valid);
  const category = (fieldId: string, value: FieldValue | undefined): string | undefined =>
    fields[fieldId]!.options.find((o) => o.id === value)?.category;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//type32//tasks//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const t of valid.tasks) {
    if (t.deletedAt !== undefined) continue;
    const zone = t.timeZone;
    const values = t.values ?? {};
    const status = category("status", values["status"]);
    const priority = category("priority", values["priority"]);
    const type =
      t.start !== undefined &&
      t.due === undefined &&
      (status === undefined || status === "cancelled")
        ? "VEVENT"
        : "VTODO";

    lines.push(
      `BEGIN:${type}`,
      `UID:${escape(t.id)}`,
      `DTSTAMP:${utc(t.updatedAt)}`,
      `LAST-MODIFIED:${utc(t.updatedAt)}`,
    );
    lines.push(`SUMMARY:${escape(t.title)}`);
    if (t.notes !== undefined) lines.push(`DESCRIPTION:${escape(t.notes)}`);
    if (typeof values["location"] === "string")
      lines.push(`LOCATION:${escape(values["location"])}`);
    if (t.start !== undefined) lines.push(when("DTSTART", t.start, zone));
    if (t.end !== undefined) {
      if (type === "VEVENT") {
        // ICS all-day ends are exclusive; ours are inclusive.
        const end = t.end.includes("T")
          ? t.end
          : Temporal.PlainDate.from(t.end).add({ days: 1 }).toString();
        lines.push(when("DTEND", end, zone));
      } else lines.push(`DURATION:${spanOf(t.start!, t.end)}`); // VTODO has no DTEND
    }
    if (t.duration !== undefined) lines.push(`DURATION:${t.duration}`);
    if (t.due !== undefined) lines.push(when("DUE", t.due, zone));
    if (status !== undefined && (type === "VTODO" || status === "cancelled"))
      lines.push(`STATUS:${STATUS_TO_ICS[status]}`);
    if (priority !== undefined) lines.push(`PRIORITY:${PRIORITY_TO_ICS[priority]}`);
    if (type === "VTODO") {
      if (typeof values["progress"] === "number")
        lines.push(`PERCENT-COMPLETE:${Math.round(values["progress"])}`);
      if (t.completedAt !== undefined) lines.push(`COMPLETED:${utc(t.completedAt)}`);
    }
    const tags = values["tags"];
    if (Array.isArray(tags) && tags.length > 0)
      lines.push(`CATEGORIES:${tags.map(escape).join(",")}`);
    if (t.parentId !== undefined) lines.push(`RELATED-TO;RELTYPE=PARENT:${escape(t.parentId)}`);
    for (const id of t.dependsOn ?? []) lines.push(`RELATED-TO;RELTYPE=DEPENDS-ON:${escape(id)}`);
    if (t.recurrence) lines.push(`RRULE:${rrule(t.recurrence, zone)}`);
    for (const d of t.excludedDates ?? []) lines.push(when("EXDATE", d, zone));
    lines.push(`END:${type}`);
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

const compact = (v: string): string =>
  (v.length === 16 ? `${v}:00` : v.slice(0, 19)).replace(/[-:]/g, "");

const utc = (v: string): string =>
  compact(Temporal.Instant.from(v).toString({ smallestUnit: "second" }).slice(0, -1)) + "Z";

function when(name: string, v: string, zone: string | undefined): string {
  if (!v.includes("T")) return `${name};VALUE=DATE:${compact(v)}`;
  if (zone === "UTC") return `${name}:${compact(v)}Z`;
  return zone === undefined ? `${name}:${compact(v)}` : `${name};TZID=${zone}:${compact(v)}`;
}

function spanOf(start: string, end: string): string {
  if (!end.includes("T")) return `P${Temporal.PlainDate.from(start).until(end).days + 1}D`;
  return Temporal.PlainDateTime.from(start).until(end, { largestUnit: "days" }).toString();
}

function rrule(r: Recurrence, zone: string | undefined): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval !== undefined) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay)
    parts.push(`BYDAY=${r.byDay.map((b) => `${b.nth ?? ""}${b.day.toUpperCase()}`).join(",")}`);
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay.join(",")}`);
  if (r.byMonth) parts.push(`BYMONTH=${r.byMonth.join(",")}`);
  if (r.count !== undefined) parts.push(`COUNT=${r.count}`);
  if (r.until !== undefined) {
    // RFC 5545: UNTIL must be UTC when DTSTART has a time zone.
    const zoned = r.until.includes("T") && zone !== undefined;
    parts.push(
      `UNTIL=${zoned ? utc(Temporal.PlainDateTime.from(r.until).toZonedDateTime(zone).toInstant().toString()) : compact(r.until)}`,
    );
  }
  return parts.join(";");
}

const escape = (v: string): string => v.replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");

/** RFC 5545 folding: lines of at most 75 octets, never splitting a UTF-8 character. */
function fold(line: string): string {
  let out = "";
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > 75) {
      out += "\r\n ";
      bytes = 1;
    }
    out += ch;
    bytes += size;
  }
  return out;
}

// --- Import ---

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  type: "VEVENT" | "VTODO";
  props: Prop[];
}

/** Thrown while reading one component; the component is dropped with this message. */
class Skip extends Error {}

const EPOCH = "1970-01-01T00:00:00Z";

/**
 * Reads VEVENT and VTODO components into tasks. Whatever the format can't express is dropped and listed
 * rather than guessed: RRULE parts beyond the supported set, changed occurrences (RECURRENCE-ID), RDATE,
 * and TZIDs that aren't IANA names. Throws `TasksFormatError` when the text isn't iCalendar.
 */
export function fromICS(text: string): ImportResult {
  if (!/^BEGIN:VCALENDAR/im.test(text)) {
    throw new TasksFormatError([{ path: [], message: "invalid ics: no BEGIN:VCALENDAR" }]);
  }
  const dropped: Issue[] = [];
  const tasks: Task[] = [];
  const successors: [before: string, after: string][] = [];
  readComponents(text).forEach((c, n) => {
    const uid = c.props.find((p) => p.name === "UID")?.value;
    try {
      if (uid === undefined) throw new Skip(`${c.type} without UID`);
      if (tasks.some((t) => t.id === uid)) throw new Skip("duplicate UID");
      tasks.push(toTask(c, uid, dropped, successors));
    } catch (error) {
      if (!(error instanceof Skip || error instanceof RangeError)) throw error;
      dropped.push({ path: [uid ?? `${c.type} #${n + 1}`], message: error.message });
    }
  });
  for (const [before, after] of successors) {
    const task = tasks.find((t) => t.id === after);
    if (task) task.dependsOn = [...new Set([...(task.dependsOn ?? []), before])];
  }
  return { document: settle({ version: "1.0", tasks }, dropped), dropped };
}

/** Removes references to tasks that weren't imported and tasks that still break a rule, until the document validates. */
function settle(doc: TaskDocument, dropped: Issue[]): TaskDocument {
  for (;;) {
    const ids = new Set(doc.tasks.map((t) => t.id));
    for (const t of doc.tasks) {
      if (t.parentId !== undefined && !ids.has(t.parentId)) {
        dropped.push({
          path: [t.id, "RELATED-TO"],
          message: `parent "${t.parentId}" isn't in the file`,
        });
        delete t.parentId;
      }
      const missing = t.dependsOn?.filter((d) => !ids.has(d)) ?? [];
      for (const d of missing)
        dropped.push({
          path: [t.id, "RELATED-TO"],
          message: `dependency "${d}" isn't in the file`,
        });
      if (missing.length > 0) {
        t.dependsOn = t.dependsOn!.filter((d) => ids.has(d));
        if (t.dependsOn.length === 0) delete t.dependsOn;
      }
    }
    try {
      return validate(doc);
    } catch (error) {
      if (!(error instanceof TasksFormatError)) throw error;
      const bad = new Set(error.issues.flatMap((i) => (i.path[0] === "tasks" ? [i.path[1]] : [])));
      if (bad.size === 0) throw error;
      for (const i of error.issues) {
        if (i.path[0] === "tasks")
          dropped.push({
            path: [doc.tasks[i.path[1] as number]!.id, ...i.path.slice(2)],
            message: i.message,
          });
      }
      doc.tasks = doc.tasks.filter((_, i) => !bad.has(i));
    }
  }
}

function toTask(c: Component, uid: string, dropped: Issue[], successors: [string, string][]): Task {
  const all = (name: string): Prop[] => c.props.filter((p) => p.name === name);
  const one = (name: string): Prop | undefined => c.props.find((p) => p.name === name);
  if (one("RECURRENCE-ID"))
    throw new Skip("changed occurrences of a recurring item aren't supported");
  if (all("RRULE").length > 1) throw new Skip("more than one RRULE");

  const startProp = one("DTSTART");
  const anchorProp = startProp ?? one("DUE");
  const dateOnly = anchorProp !== undefined && isDateValue(anchorProp);
  const zone = anchorProp === undefined || dateOnly ? undefined : zoneOf(anchorProp);
  // Every time on the task is read in the anchor's zone, in the anchor's form unless noted.
  const local = (p: Prop, asDate = dateOnly): string =>
    toLocal(parseTime(p.value, p.params["TZID"], isDateValue(p)), zone, asDate);

  const changed = one("LAST-MODIFIED") ?? one("DTSTAMP"); // DTSTAMP alone is often the export time
  const task: Task = {
    id: uid,
    title: unescape(one("SUMMARY")?.value ?? "")[0]!,
    updatedAt: changed ? instant(changed.value) : EPOCH,
  };
  const values: Record<string, FieldValue> = {};
  const description = one("DESCRIPTION");
  if (description) task.notes = unescape(description.value)[0]!;
  const location = one("LOCATION");
  if (location) values["location"] = unescape(location.value)[0]!;

  if (startProp) task.start = local(startProp);
  if (zone !== undefined) task.timeZone = zone;
  const dtend = one("DTEND");
  if (dtend && task.start !== undefined) {
    if (dateOnly) {
      // ICS all-day ends are exclusive; ours are inclusive.
      const last = Temporal.PlainDate.from(local(dtend)).subtract({ days: 1 });
      task.end = Temporal.PlainDate.compare(last, task.start) < 0 ? task.start : last.toString();
    } else task.end = local(dtend);
  }
  const duration = one("DURATION");
  if (duration && !dtend) task.duration = duration.value;
  const due = one("DUE");
  if (due) task.due = local(due, isDateValue(due));

  const status = STATUS_FROM_ICS[one("STATUS")?.value.toUpperCase() ?? ""];
  if (status) values["status"] = status;
  const priority = Number(one("PRIORITY")?.value);
  if (priority >= 1 && priority <= 9)
    values["priority"] = priority <= 4 ? "high" : priority === 5 ? "medium" : "low";
  const percent = Number(one("PERCENT-COMPLETE")?.value);
  if (Number.isFinite(percent)) values["progress"] = Math.min(100, Math.max(0, percent));
  const completed = one("COMPLETED");
  if (completed) task.completedAt = instant(completed.value);
  const tags = [
    ...new Set(
      all("CATEGORIES")
        .flatMap((p) => unescape(p.value, true))
        .map((s) => s.trim()),
    ),
  ].filter(Boolean);
  if (tags.length > 0) values["tags"] = tags;
  if (Object.keys(values).length > 0) task.values = values;

  for (const p of all("RELATED-TO")) {
    const target = unescape(p.value)[0]!;
    const type = (p.params["RELTYPE"] ?? "PARENT").toUpperCase();
    if (type === "PARENT") task.parentId ??= target;
    else if (type === "DEPENDS-ON") task.dependsOn = [...(task.dependsOn ?? []), target];
    else if (type === "FINISHTOSTART") successors.push([uid, target]); // this task must finish before `target` starts
  }

  const rule = one("RRULE");
  if (rule) {
    if (anchorProp === undefined) throw new Skip("RRULE without DTSTART or DUE");
    task.recurrence = parseRule(rule.value, (v) => {
      const time = parseTime(v, undefined, /^\d{8}$/.test(v));
      // A date UNTIL on a timed rule still includes that whole day.
      const end =
        time instanceof Temporal.PlainDate && !dateOnly
          ? time.toPlainDateTime({ hour: 23, minute: 59, second: 59 })
          : time;
      return toLocal(end, zone, dateOnly);
    });
    const excluded = all("EXDATE").flatMap((p) =>
      p.value
        .split(",")
        .map((v) => toLocal(parseTime(v, p.params["TZID"], /^\d{8}$/.test(v)), zone, dateOnly)),
    );
    if (excluded.length > 0) task.excludedDates = excluded;
  }
  if (one("RDATE"))
    dropped.push({ path: [uid, "RDATE"], message: "extra dates (RDATE) aren't supported" });
  return task;
}

const isDateValue = (p: Prop): boolean =>
  p.params["VALUE"]?.toUpperCase() === "DATE" || /^\d{8}$/.test(p.value);

const zoneOf = (p: Prop): string | undefined =>
  p.params["TZID"] ?? (p.value.endsWith("Z") ? "UTC" : undefined);

type Time = Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;

function parseTime(value: string, tzid: string | undefined, dateOnly: boolean): Time {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) throw new Skip(`unreadable date "${value}"`);
  const [, y, mo, d, h, mi, s, z] = m;
  if (dateOnly || h === undefined) return Temporal.PlainDate.from(`${y}-${mo}-${d}`);
  const wall = Temporal.PlainDateTime.from(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  if (z) return wall.toZonedDateTime("UTC");
  return tzid === undefined ? wall : wall.toZonedDateTime(tzid); // RangeError for non-IANA TZIDs
}

/** Renders a time in the task's zone and form; floating times are taken as already local. */
function toLocal(time: Time, zone: string | undefined, asDate: boolean): string {
  let wall: Temporal.PlainDateTime;
  if (time instanceof Temporal.PlainDate) {
    if (asDate) return time.toString();
    wall = time.toPlainDateTime();
  } else if (time instanceof Temporal.ZonedDateTime) {
    wall = (zone === undefined ? time : time.withTimeZone(zone)).toPlainDateTime();
  } else wall = time;
  if (asDate) return wall.toPlainDate().toString();
  return wall.toString({ smallestUnit: wall.second === 0 ? "minute" : "second" });
}

function instant(value: string): string {
  const time = parseTime(value, undefined, false);
  const zoned = time instanceof Temporal.ZonedDateTime ? time : time.toZonedDateTime("UTC");
  return zoned.toInstant().toString();
}

const WEEKDAY = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

function parseRule(value: string, until: (v: string) => string): Recurrence {
  const rule: Partial<Recurrence> = {};
  let weekStart = "MO";
  const int = (v: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Skip(`RRULE: "${v}" isn't a whole number`);
    return n;
  };
  for (const part of value.split(";")) {
    const [key = "", v = ""] = part.split("=");
    switch (key.toUpperCase()) {
      case "FREQ": {
        const freq = v.toLowerCase();
        if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") {
          throw new Skip(`RRULE: FREQ=${v} isn't supported`);
        }
        rule.freq = freq;
        break;
      }
      case "INTERVAL":
        rule.interval = int(v);
        break;
      case "COUNT":
        rule.count = int(v);
        break;
      case "UNTIL":
        rule.until = until(v);
        break;
      case "BYDAY":
        rule.byDay = v.split(",").map((d) => {
          const m = WEEKDAY.exec(d.toUpperCase());
          if (!m) throw new Skip(`RRULE: BYDAY=${d} isn't readable`);
          const day = m[2]!.toLowerCase() as Weekday;
          return m[1] === undefined ? { day } : { day, nth: int(m[1]) };
        });
        break;
      case "BYMONTHDAY":
        rule.byMonthDay = v.split(",").map(int);
        break;
      case "BYMONTH":
        rule.byMonth = v.split(",").map(int);
        break;
      case "WKST":
        weekStart = v.toUpperCase();
        break;
      default:
        throw new Skip(`RRULE: ${key} isn't supported`);
    }
  }
  if (rule.freq === undefined) throw new Skip("RRULE without FREQ");
  // Week start only changes results for multi-week intervals with several weekdays.
  if (
    weekStart !== "MO" &&
    rule.freq === "weekly" &&
    (rule.interval ?? 1) > 1 &&
    (rule.byDay?.length ?? 0) > 1
  ) {
    throw new Skip(`RRULE: WKST=${weekStart} isn't supported`);
  }
  return rule as Recurrence;
}

/** Content lines of top-level VEVENT/VTODO components; nested ones (VALARM) are skipped. */
function readComponents(text: string): Component[] {
  const out: Component[] = [];
  const stack: string[] = [];
  let current: Component | undefined;
  for (const raw of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const prop = parseProp(raw);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const type = prop.value.toUpperCase();
      stack.push(type);
      if (
        stack.length === 2 &&
        stack[0] === "VCALENDAR" &&
        (type === "VEVENT" || type === "VTODO")
      ) {
        current = { type, props: [] };
        out.push(current);
      }
    } else if (prop.name === "END") {
      if (stack.pop() === current?.type && stack.length === 1) current = undefined;
    } else if (current && stack.length === 2) current.props.push(prop);
  }
  return out;
}

function parseProp(line: string): Prop | undefined {
  const nameEnd = line.search(/[;:]/);
  if (nameEnd < 1) return undefined;
  const params: Record<string, string> = {};
  let pos = nameEnd;
  while (line[pos] === ";") {
    const eq = line.indexOf("=", pos);
    if (eq < 0) return undefined;
    let end = eq + 1;
    let value: string;
    if (line[end] === '"') {
      const close = line.indexOf('"', end + 1);
      if (close < 0) return undefined;
      value = line.slice(end + 1, close);
      end = close + 1;
    } else {
      const stop = line.slice(end).search(/[;:]/);
      if (stop < 0) return undefined;
      value = line.slice(end, end + stop);
      end += stop;
    }
    params[line.slice(pos + 1, eq).toUpperCase()] = value;
    pos = end;
  }
  if (line[pos] !== ":") return undefined;
  return { name: line.slice(0, nameEnd).toUpperCase(), params, value: line.slice(pos + 1) };
}

/** TEXT unescaping; with `split`, unescaped commas separate values (CATEGORIES). */
function unescape(value: string, split = false): string[] {
  const parts = [""];
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && i + 1 < value.length) {
      const next = value[++i]!;
      parts[parts.length - 1] += next === "n" || next === "N" ? "\n" : next;
    } else if (c === "," && split) parts.push("");
    else parts[parts.length - 1] += c;
  }
  return parts;
}
