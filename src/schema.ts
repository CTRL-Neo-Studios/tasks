import * as z from "zod";
import { findCycle } from "./cycle";

/** `2026-11-09`. All-day when used as a task time. */
export type LocalDate = string;
/** `2026-11-09T10:00`, optional seconds and fraction, never an offset. Read in the task's `timeZone`, floating without one. */
export type LocalDateTime = string;
/** `2026-11-09T10:00:00Z`. */
export type UTCDateTime = string;
/** ISO 8601 duration without years or months: `PT1H30M`, `P1D`, `P2W`. */
export type Duration = string;

export type FieldType = "text" | "number" | "boolean" | "date" | "url" | "select" | "multiSelect";
export type FieldValue = string | number | boolean | string[];
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export type Weekday = "mo" | "tu" | "we" | "th" | "fr" | "sa" | "su";
/** Derived from which time fields a task has; never stored. */
export type Kind = "span" | "moment" | "todo";

/** Anything `merge()` can reconcile: identified, timestamped, soft-deleted. */
export interface Synced {
  id: string;
  updatedAt: UTCDateTime;
  deletedAt?: UTCDateTime;
  /** Unknown keys are kept and written back. */
  [key: string]: unknown;
}

export interface List extends Synced {
  title: string;
  color?: string;
  parentId?: string;
}

export interface FieldOption extends Synced {
  title?: string;
  color?: string;
  category?: string;
}

/**
 * Built-in ids (`status`, `priority`, `tags`, `progress`, `location`) only take `options`;
 * everything else needs `title`, `type`, `updatedAt`.
 */
export interface FieldDefinition {
  id: string;
  title?: string;
  type?: FieldType;
  categories?: string[];
  open?: boolean;
  min?: number;
  max?: number;
  options?: FieldOption[];
  updatedAt?: UTCDateTime;
  deletedAt?: UTCDateTime;
  [key: string]: unknown;
}

export interface Recurrence {
  freq: Frequency;
  interval?: number;
  /** `nth` (e.g. 2 = second, -1 = last) only with monthly/yearly. */
  byDay?: { day: Weekday; nth?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  until?: LocalDate | LocalDateTime;
}

export interface Task extends Synced {
  title: string;
  notes?: string;
  listId?: string;
  parentId?: string;
  dependsOn?: string[];
  start?: LocalDate | LocalDateTime;
  end?: LocalDate | LocalDateTime;
  duration?: Duration;
  due?: LocalDate | LocalDateTime;
  timeZone?: string;
  recurrence?: Recurrence;
  excludedDates?: (LocalDate | LocalDateTime)[];
  completedAt?: UTCDateTime;
  values?: Record<string, FieldValue>;
}

export interface TaskDocument {
  version: string;
  lists?: List[];
  fields?: FieldDefinition[];
  tasks: Task[];
  [key: string]: unknown;
}

export interface ResolvedOption {
  id: string;
  title: string;
  color?: string;
  category?: string;
  deleted: boolean;
}

/** A field with built-in defaults and document overrides applied. */
export interface ResolvedField {
  id: string;
  title: string;
  type: FieldType;
  categories?: readonly string[];
  open: boolean;
  min?: number;
  max?: number;
  options: ResolvedOption[];
  builtIn: boolean;
  deleted: boolean;
}

const builtIn = (
  id: string,
  title: string,
  type: FieldType,
  extra: Partial<ResolvedField> = {},
): ResolvedField => ({
  id,
  title,
  type,
  open: false,
  options: [],
  builtIn: true,
  deleted: false,
  ...extra,
});

const categorized = (pairs: [id: string, title: string][]): Partial<ResolvedField> => ({
  categories: pairs.map(([id]) => id),
  options: pairs.map(([id, title]) => ({ id, title, category: id, deleted: false })),
});

// Null prototype: field ids come from documents, so "constructor" or "__proto__" must not hit Object.prototype.
const BUILT_IN_FIELDS: Record<string, ResolvedField> = Object.assign(Object.create(null), {
  status: builtIn(
    "status",
    "Status",
    "select",
    categorized([
      ["todo", "To do"],
      ["doing", "In progress"],
      ["done", "Done"],
      ["cancelled", "Cancelled"],
    ]),
  ),
  priority: builtIn(
    "priority",
    "Priority",
    "select",
    categorized([
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ]),
  ),
  tags: builtIn("tags", "Tags", "multiSelect", { open: true }),
  progress: builtIn("progress", "Progress", "number", { min: 0, max: 100 }),
  location: builtIn("location", "Location", "text"),
});

/** Built-in fields merged with the document's `fields`. Deleted fields and options stay, flagged `deleted`. */
export function resolveFields(doc: Pick<TaskDocument, "fields">): Record<string, ResolvedField> {
  const out: Record<string, ResolvedField> = Object.create(null);
  for (const [id, f] of Object.entries(BUILT_IN_FIELDS)) {
    out[id] = { ...f, options: f.options.map((o) => ({ ...o })) };
  }
  for (const def of doc.fields ?? []) {
    let field = out[def.id];
    if (!field?.builtIn) {
      field = out[def.id] = {
        id: def.id,
        title: def.title ?? def.id,
        type: def.type ?? "text",
        open: def.open ?? false,
        options: [],
        builtIn: false,
        deleted: def.deletedAt !== undefined,
        ...(def.categories && { categories: def.categories }),
        ...(def.min !== undefined && { min: def.min }),
        ...(def.max !== undefined && { max: def.max }),
      };
    }
    for (const o of def.options ?? []) {
      const i = field.options.findIndex((x) => x.id === o.id);
      const base = field.options[i];
      const category = base?.category ?? o.category;
      const resolved: ResolvedOption = {
        id: o.id,
        title: o.title ?? base?.title ?? o.id,
        deleted: o.deletedAt !== undefined,
        ...(o.color !== undefined && { color: o.color }),
        ...(category !== undefined && { category }),
      };
      if (base) field.options[i] = resolved;
      else field.options.push(resolved);
    }
  }
  return out;
}

export function kindOf(task: Pick<Task, "start" | "end" | "duration">): Kind {
  if (task.start === undefined) return "todo";
  return task.end !== undefined || task.duration !== undefined ? "span" : "moment";
}

// --- Primitives ---

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?$/;
const DURATION_RE = /^P(?!$)(?:\d+W|(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isLocalDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days;
}

const isLocal = (v: string): boolean => {
  const m = DATE_TIME_RE.exec(v);
  return m ? isLocalDate(m[1]!) : isLocalDate(v);
};

const isDateOnly = (v: string): boolean => !v.includes("T");

/** Comparable key for two local values of the same form (seconds and fraction padded). */
export function sortKey(v: string): string {
  if (isDateOnly(v)) return v;
  let s = v.length === 16 ? `${v}:00` : v;
  if (s.length === 19) s += ".";
  return s.padEnd(29, "0");
}

// Building an Intl.DateTimeFormat costs tens of microseconds; only valid zones are cached, so the set stays
// bounded by the IANA database however many bad names arrive.
const knownZones = new Set<string>();

function isTimeZone(v: string): boolean {
  if (knownZones.has(v)) return true;
  if (/^[+-]/.test(v)) return false; // offsets are not IANA zones
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v }).resolvedOptions();
  } catch {
    return false;
  }
  knownZones.add(v);
  return true;
}

const id = z.string().min(1, "expected a non-empty id");
const utc = z.iso.datetime("expected a UTC date-time like 2026-11-09T10:00:00Z");
const local = z
  .string()
  .refine(isLocal, "expected a date (2026-11-09) or a date-time without offset (2026-11-09T10:00)");
const color = z.string().regex(COLOR_RE, "expected a #rrggbb color");
const nonZero = (min: number, max: number) =>
  z
    .int()
    .min(min)
    .max(max)
    .refine((n) => n !== 0, "0 is not allowed");

const synced = { id, updatedAt: utc, deletedAt: utc.exactOptional() };

const listSchema = z.looseObject({
  ...synced,
  title: z.string(),
  color: color.exactOptional(),
  parentId: id.exactOptional(),
});

const optionSchema = z.looseObject({
  ...synced,
  title: z.string().exactOptional(),
  color: color.exactOptional(),
  category: z.string().min(1).exactOptional(),
});

const fieldSchema = z.looseObject({
  id,
  title: z.string().exactOptional(),
  type: z
    .enum(["text", "number", "boolean", "date", "url", "select", "multiSelect"])
    .exactOptional(),
  categories: z.array(z.string().min(1)).min(1).exactOptional(),
  open: z.boolean().exactOptional(),
  min: z.number().exactOptional(),
  max: z.number().exactOptional(),
  options: z.array(optionSchema).exactOptional(),
  updatedAt: utc.exactOptional(),
  deletedAt: utc.exactOptional(),
});

// Strict: an unknown rule part (e.g. bySetPos) would silently change which dates recur.
const recurrenceSchema = z.strictObject({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.int().min(1).exactOptional(),
  byDay: z
    .array(
      z.strictObject({
        day: z.enum(["mo", "tu", "we", "th", "fr", "sa", "su"]),
        nth: nonZero(-53, 53).exactOptional(),
      }),
    )
    .min(1)
    .exactOptional(),
  byMonthDay: z.array(nonZero(-31, 31)).min(1).exactOptional(),
  byMonth: z.array(z.int().min(1).max(12)).min(1).exactOptional(),
  count: z.int().min(1).exactOptional(),
  until: local.exactOptional(),
});

const taskSchema = z.looseObject({
  ...synced,
  title: z.string(),
  notes: z.string().exactOptional(),
  listId: id.exactOptional(),
  parentId: id.exactOptional(),
  dependsOn: z.array(id).exactOptional(),
  start: local.exactOptional(),
  end: local.exactOptional(),
  duration: z
    .string()
    .regex(DURATION_RE, "expected an ISO 8601 duration like PT1H30M")
    .exactOptional(),
  due: local.exactOptional(),
  timeZone: z
    .string()
    .refine(isTimeZone, "expected an IANA time zone like Europe/Berlin")
    .exactOptional(),
  recurrence: recurrenceSchema.exactOptional(),
  excludedDates: z.array(local).exactOptional(),
  completedAt: utc.exactOptional(),
  values: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string())], {
        error: "expected text, a finite number, true/false, or a list of strings",
      }),
    )
    .exactOptional(),
});

/** The whole format. Use `validate()`/`parse()` for errors as `TasksFormatError`. */
export const documentSchema: z.ZodType<TaskDocument> = z
  .looseObject({
    version: z.string().regex(/^1\.\d+$/, "unsupported version; this library reads 1.x"),
    lists: z.array(listSchema).exactOptional(),
    fields: z.array(fieldSchema).exactOptional(),
    tasks: z.array(taskSchema),
  })
  .superRefine((doc, ctx) =>
    checkDocument(doc, (path, message) => ctx.addIssue({ code: "custom", path, message })),
  );

/** One task on its own: shape and time rules. References and `values` need the whole document. */
export const standaloneTaskSchema: z.ZodType<Task> = taskSchema.superRefine((t, ctx) =>
  checkTime(t, [], (path, message) => ctx.addIssue({ code: "custom", path, message })),
);

// --- Cross-field rules ---

type Path = (string | number)[];
type Report = (path: Path, message: string) => void;

function checkDocument(doc: TaskDocument, issue: Report): void {
  const lists = doc.lists ?? [];
  const defs = doc.fields ?? [];
  const { tasks } = doc;

  checkUnique(lists, ["lists"], issue);
  checkUnique(defs, ["fields"], issue);
  checkUnique(tasks, ["tasks"], issue);

  const listIds = new Set(lists.map((l) => l.id));
  lists.forEach((l, i) => {
    if (l.parentId !== undefined && !listIds.has(l.parentId)) {
      issue(["lists", i, "parentId"], `unknown list "${l.parentId}"`);
    }
  });
  checkAcyclic(
    lists,
    (l) => (l.parentId === undefined ? [] : [l.parentId]),
    ["lists"],
    "parentId",
    issue,
  );

  defs.forEach((f, i) => checkField(f, ["fields", i], issue));
  const fields = resolveFields(doc);

  const taskIds = new Set(tasks.map((t) => t.id));
  tasks.forEach((t, i) => {
    const p = ["tasks", i];
    if (t.listId !== undefined && !listIds.has(t.listId))
      issue([...p, "listId"], `unknown list "${t.listId}"`);
    if (t.parentId !== undefined && !taskIds.has(t.parentId)) {
      issue([...p, "parentId"], `unknown task "${t.parentId}"`);
    }
    t.dependsOn?.forEach((d, j) => {
      if (!taskIds.has(d)) issue([...p, "dependsOn", j], `unknown task "${d}"`);
    });
    checkTime(t, p, issue);
    for (const [key, value] of Object.entries(t.values ?? {})) {
      const field = fields[key];
      const error = field
        ? valueError(field, value)
        : `unknown field "${key}"; define it in "fields"`;
      if (error) issue([...p, "values", key], error);
    }
  });
  checkAcyclic(
    tasks,
    (t) => (t.parentId === undefined ? [] : [t.parentId]),
    ["tasks"],
    "parentId",
    issue,
  );
  checkAcyclic(tasks, (t) => t.dependsOn ?? [], ["tasks"], "dependsOn", issue);
}

function checkUnique(items: readonly { id: string }[], path: Path, issue: Report): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) issue([...path, i, "id"], `duplicate id "${item.id}"`);
    seen.add(item.id);
  });
}

/** Reports the first cycle found along `edges`; edges to unknown ids are ignored. */
function checkAcyclic<T extends { id: string }>(
  items: readonly T[],
  edges: (item: T) => readonly string[],
  path: Path,
  key: string,
  issue: Report,
): void {
  const cycle = findCycle(items, edges);
  if (cycle)
    issue([...path, cycle[0]!, key], `"${items[cycle[0]!]!.id}" is part of a ${key} cycle`);
}

const LOCKED_KEYS = ["title", "type", "categories", "open", "min", "max", "deletedAt"] as const;

function checkField(f: FieldDefinition, path: Path, issue: Report): void {
  const base = BUILT_IN_FIELDS[f.id];
  const type = base?.type ?? f.type;
  const select = type === "select" || type === "multiSelect";
  if (base) {
    for (const key of LOCKED_KEYS) {
      if (f[key] !== undefined)
        issue([...path, key], `built-in field "${f.id}" is locked; only its options can change`);
    }
  } else {
    for (const key of ["title", "type", "updatedAt"] as const) {
      if (f[key] === undefined) issue([...path, key], `custom fields need "${key}"`);
    }
    if (!select) {
      for (const key of ["categories", "open"] as const) {
        if (f[key] !== undefined) issue([...path, key], `only select fields can have "${key}"`);
      }
    }
    if (f.type !== "number") {
      for (const key of ["min", "max"] as const) {
        if (f[key] !== undefined) issue([...path, key], `only number fields can have "${key}"`);
      }
    }
    if (f.min !== undefined && f.max !== undefined && f.min > f.max)
      issue([...path, "max"], "max is below min");
    f.categories?.forEach((c, i) => {
      if (f.categories!.indexOf(c) !== i)
        issue([...path, "categories", i], `duplicate category "${c}"`);
    });
  }

  if (f.options === undefined) return;
  if (!select) return issue([...path, "options"], `only select fields can have "options"`);
  checkUnique(f.options, [...path, "options"], issue);
  const categories = base ? base.categories : f.categories;
  f.options.forEach((o, j) => {
    const p = [...path, "options", j];
    const builtInOption = base?.options.find((b) => b.id === o.id);
    if (builtInOption) {
      if (o.category !== undefined && o.category !== builtInOption.category) {
        issue(
          [...p, "category"],
          `built-in option "${o.id}" is always "${builtInOption.category}"`,
        );
      }
      if (o.deletedAt !== undefined)
        issue([...p, "deletedAt"], "built-in options can't be deleted");
      return;
    }
    if (o.title === undefined) issue([...p, "title"], "options need a title");
    if (!categories) {
      if (o.category !== undefined) issue([...p, "category"], `field "${f.id}" has no categories`);
    } else if (
      o.deletedAt === undefined &&
      (o.category === undefined || !categories.includes(o.category))
    ) {
      issue([...p, "category"], `expected one of: ${categories.join(", ")}`);
    }
  });
}

function checkTime(t: Task, path: Path, issue: Report): void {
  const { start, end, duration, recurrence, excludedDates } = t;
  if (end !== undefined) {
    if (start === undefined) issue([...path, "end"], "end needs start");
    else if (isDateOnly(start) !== isDateOnly(end)) {
      issue([...path, "end"], "end must match start: both dates or both date-times");
    } else if (sortKey(end) < sortKey(start)) issue([...path, "end"], "end is before start");
  }
  if (duration !== undefined) {
    if (start === undefined) issue([...path, "duration"], "duration needs start");
    else if (isDateOnly(start) && duration.includes("T")) {
      issue([...path, "duration"], "all-day tasks need a duration in days or weeks");
    }
    if (end !== undefined) issue([...path, "duration"], "use end or duration, not both");
  }

  const anchor = start ?? t.due;
  const sameForm = (v: string, p: Path): void => {
    if (anchor !== undefined && isDateOnly(v) !== isDateOnly(anchor)) {
      issue(
        p,
        `must match ${start === undefined ? "due" : "start"}: both dates or both date-times`,
      );
    }
  };
  if (recurrence) {
    const p = [...path, "recurrence"];
    if (anchor === undefined) issue(p, "recurrence needs start or due");
    if (recurrence.until !== undefined) sameForm(recurrence.until, [...p, "until"]);
    if (recurrence.count !== undefined && recurrence.until !== undefined)
      issue(p, "use count or until, not both");
    if (recurrence.freq === "daily" || recurrence.freq === "weekly") {
      recurrence.byDay?.forEach((d, i) => {
        if (d.nth !== undefined)
          issue([...p, "byDay", i, "nth"], "nth needs monthly or yearly freq");
      });
    }
  }
  excludedDates?.forEach((d, i) => {
    const p = [...path, "excludedDates", i];
    if (!recurrence) issue(p, "excludedDates needs recurrence");
    else sameForm(d, p);
  });
}

/** Why `v` can't be stored in field `f`, or undefined when it can. */
export function valueError(f: ResolvedField, v: FieldValue): string | undefined {
  const optionError = (optionId: string): string | undefined =>
    f.open || f.options.some((o) => o.id === optionId)
      ? undefined
      : `unknown option "${optionId}" for field "${f.id}"`;
  switch (f.type) {
    case "text":
      return typeof v === "string" ? undefined : "expected text";
    case "url":
      return typeof v === "string" && URL.canParse(v) ? undefined : "expected a URL";
    case "boolean":
      return typeof v === "boolean" ? undefined : "expected true or false";
    case "date":
      return typeof v === "string" && isLocal(v) ? undefined : "expected a date or local date-time";
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return "expected a number";
      if (f.min !== undefined && v < f.min) return `must be at least ${f.min}`;
      if (f.max !== undefined && v > f.max) return `must be at most ${f.max}`;
      return undefined;
    case "select":
      return typeof v === "string" ? optionError(v) : "expected one option id";
    case "multiSelect":
      if (!Array.isArray(v)) return "expected a list of option ids";
      if (new Set(v).size !== v.length) return "duplicate options";
      return v.map(optionError).find((e) => e !== undefined);
  }
}
