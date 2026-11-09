import { Temporal } from "temporal-polyfill"; // uses native Temporal when the runtime has it
import type { LocalDate, LocalDateTime, Recurrence, Task, Weekday } from "./schema";

/** One occurrence in the task's own local form; `end` is inclusive for all-day tasks, like `Task.end`. */
export interface Occurrence {
  start?: LocalDate | LocalDateTime;
  end?: LocalDate | LocalDateTime;
  due?: LocalDate | LocalDateTime;
}

export interface OccurrenceRange {
  /** Inclusive. */
  from: LocalDate | LocalDateTime;
  /** Exclusive. */
  to: LocalDate | LocalDateTime;
  /** Wall clock `from`/`to` are read in. Default: each task's own `timeZone`. Floating and all-day tasks ignore it. */
  timeZone?: string;
}

type DateTime = Temporal.PlainDateTime;
const { PlainDate, PlainDateTime } = Temporal;

const WEEKDAYS: readonly Weekday[] = ["mo", "tu", "we", "th", "fr", "sa", "su"]; // Temporal dayOfWeek 1 = Monday

/**
 * Occurrences of `task` overlapping `[from, to)`, in order. Works for any task: one without `recurrence`
 * has at most one occurrence, and one without `start` or `due` has none. Spans get an `end` even when the
 * task stores `duration`. Assumes a validated task.
 */
export function occurrences(task: Task, range: OccurrenceRange): Occurrence[] {
  const anchorText = task.start ?? task.due;
  if (anchorText === undefined) return [];
  const allDay = !anchorText.includes("T");
  const anchor = PlainDateTime.from(anchorText);
  const zone = allDay ? undefined : task.timeZone;
  const view = range.timeZone ?? zone;
  const from = PlainDateTime.from(range.from);
  const to = PlainDateTime.from(range.to);

  // Span length from start, applied to every occurrence: days are calendar days, hours are elapsed time.
  let span: Temporal.Duration | undefined;
  if (task.duration !== undefined) span = Temporal.Duration.from(task.duration);
  else if (task.end !== undefined) {
    const end = PlainDateTime.from(task.end);
    span = anchor.until(allDay ? end.add({ days: 1 }) : end, { largestUnit: "days" });
  }
  const dueOffset =
    task.start !== undefined && task.due !== undefined
      ? anchor.until(PlainDateTime.from(task.due), { largestUnit: "days" })
      : undefined;

  const build = (occurrence: DateTime): Occurrence | undefined => {
    let start = occurrence;
    let end = span && start.add(span);
    let [viewStart, viewEnd] = [start, end];
    if (zone !== undefined) {
      const zoned = occurrence.toZonedDateTime(zone); // a time skipped by DST moves forward
      const zonedEnd = span && zoned.add(span);
      start = zoned.toPlainDateTime();
      end = zonedEnd?.toPlainDateTime();
      viewStart = zoned.withTimeZone(view!).toPlainDateTime();
      viewEnd = zonedEnd?.withTimeZone(view!).toPlainDateTime();
    }
    const overlaps =
      PlainDateTime.compare(viewStart, to) < 0 &&
      (PlainDateTime.compare(viewStart, from) >= 0 ||
        (viewEnd !== undefined && PlainDateTime.compare(viewEnd, from) > 0));
    if (!overlaps) return undefined;

    const out: Occurrence = {};
    if (task.start !== undefined) out.start = format(start, task.start);
    if (end !== undefined) {
      if (allDay) {
        const last = end.subtract({ days: 1 });
        out.end = (PlainDateTime.compare(last, start) < 0 ? start : last).toPlainDate().toString();
      } else out.end = format(end, task.end ?? task.start!);
    }
    if (task.due !== undefined)
      out.due = format(dueOffset ? start.add(dueOffset) : start, task.due);
    return out;
  };

  const rule = task.recurrence;
  // Generation runs in the task's wall clock; the margin covers a view zone up to two days apart.
  const limit = to.add({ days: 2 });
  const until = rule?.until === undefined ? undefined : PlainDateTime.from(rule.until);
  const excluded = new Set(task.excludedDates?.map((d) => PlainDateTime.from(d).toString()));
  const result: Occurrence[] = [];
  let count = 0;
  for (const occurrence of rule ? recur(anchor, rule, limit) : [anchor]) {
    if (PlainDateTime.compare(occurrence, limit) > 0) break;
    if (until && PlainDateTime.compare(occurrence, until) > 0) break;
    if (rule?.count !== undefined && count++ >= rule.count) break;
    if (excluded.has(occurrence.toString())) continue;
    const built = build(occurrence);
    if (!built) continue;
    // A wall-clock time a zone skipped (Samoa dropped 2011-12-30) moves forward onto the next occurrence.
    const last = result.at(-1);
    if (last && (last.start ?? last.due) === (built.start ?? built.due)) continue;
    result.push(built);
  }
  return result;
}

/** Keeps the source's form: date-only stays a date, a time written without seconds stays without them. */
function format(value: DateTime, like: string): string {
  if (!like.includes("T")) return value.toPlainDate().toString();
  const whole =
    value.second === 0 &&
    value.millisecond === 0 &&
    value.microsecond === 0 &&
    value.nanosecond === 0;
  return like.length === 16 && whole
    ? value.toString({ smallestUnit: "minute" })
    : value.toString();
}

/**
 * RFC 5545-style expansion of the supported rule parts. The anchor always comes first, even if the rule
 * wouldn't produce it. Weeks start on Monday. Stops once a period starts after `limit`, so a rule matching
 * no dates (e.g. 30 February) still terminates.
 */
function* recur(anchor: DateTime, rule: Recurrence, limit: DateTime): Generator<DateTime> {
  yield anchor;
  const first = anchor.toPlainDate();
  const time = anchor.toPlainTime();
  const end = limit.toPlainDate();
  const step = rule.interval ?? 1;
  const monday = first.subtract({ days: first.dayOfWeek - 1 });
  for (let k = 0; ; k += step) {
    let period: Temporal.PlainDate;
    let candidates: Temporal.PlainDate[];
    switch (rule.freq) {
      case "daily":
        period = first.add({ days: k });
        candidates = [period];
        break;
      case "weekly":
        period = monday.add({ weeks: k });
        candidates = Array.from({ length: 7 }, (_, i) => period.add({ days: i }));
        if (!rule.byDay) candidates = candidates.filter((d) => d.dayOfWeek === first.dayOfWeek);
        break;
      case "monthly":
        period = first.with({ day: 1 }).add({ months: k });
        candidates = monthDays(period, rule, first.day);
        break;
      case "yearly": {
        period = PlainDate.from({ year: first.year + k, month: 1, day: 1 });
        const months =
          rule.byMonth ??
          (rule.byMonthDay || rule.byDay ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [first.month]);
        candidates = months.flatMap((month) => monthDays(period.with({ month }), rule, first.day));
        break;
      }
    }
    if (PlainDate.compare(period, end) > 0) return;
    const dates = candidates
      .filter((d) => matches(d, rule) && PlainDate.compare(d, first) > 0)
      .toSorted(PlainDate.compare);
    for (let i = 0; i < dates.length; i++) {
      if (i > 0 && dates[i]!.equals(dates[i - 1]!)) continue;
      yield dates[i]!.toPlainDateTime(time);
    }
  }
}

/** Days of `month` the rule expands to: BYMONTHDAY, every day (BYDAY filters later), or the anchor's day. */
function monthDays(
  month: Temporal.PlainDate,
  rule: Recurrence,
  anchorDay: number,
): Temporal.PlainDate[] {
  const days = rule.byMonthDay
    ? rule.byMonthDay.map((d) => (d > 0 ? d : month.daysInMonth + d + 1))
    : rule.byDay
      ? Array.from({ length: month.daysInMonth }, (_, i) => i + 1)
      : [anchorDay];
  return days.filter((d) => d >= 1 && d <= month.daysInMonth).map((day) => month.with({ day }));
}

/** BYMONTH, BYMONTHDAY and BYDAY as limits; `nth` counts within the month, or the year for yearly rules without BYMONTH. */
function matches(d: Temporal.PlainDate, rule: Recurrence): boolean {
  if (rule.byMonth && !rule.byMonth.includes(d.month)) return false;
  if (
    rule.byMonthDay &&
    !rule.byMonthDay.some((n) => (n > 0 ? n : d.daysInMonth + n + 1) === d.day)
  )
    return false;
  if (!rule.byDay) return true;
  const inYear = rule.freq === "yearly" && !rule.byMonth;
  const [index, length] = inYear ? [d.dayOfYear, d.daysInYear] : [d.day, d.daysInMonth];
  const nth = Math.ceil(index / 7);
  const nthFromEnd = -Math.ceil((length - index + 1) / 7);
  return rule.byDay.some(
    (b) =>
      b.day === WEEKDAYS[d.dayOfWeek - 1] &&
      (b.nth === undefined || b.nth === nth || b.nth === nthFromEnd),
  );
}
