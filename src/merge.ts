import { Temporal } from "temporal-polyfill";
import { findCycle } from "./cycle";
import { type Issue, validate } from "./parse";
import {
  type FieldDefinition,
  resolveFields,
  sortKey,
  type TaskDocument,
  valueError,
} from "./schema";

/** Something `merge()` changed so the merged document stays valid. `removed` holds the dropped data. */
export interface Repair {
  path: Issue["path"];
  message: string;
  removed: unknown;
}

export interface MergeResult {
  document: TaskDocument;
  repairs: Repair[];
}

interface Stamped {
  id: string;
  updatedAt?: string;
  deletedAt?: string;
}

const CORE_KEYS = new Set(["version", "lists", "fields", "tasks"]);

/**
 * Merges two copies of a document record by record: lists, tasks, custom fields and each field option.
 * The later `updatedAt` wins; on a tie the deleted record wins, then the larger canonical JSON, so the
 * content is the same whichever side runs the merge. Record order follows `a`, with records new in `b` appended.
 *
 * Two valid copies can combine into an invalid document (a move cycle, a value whose field changed type).
 * Those are repaired and listed in `repairs`. Throws `TasksFormatError` if either input is invalid.
 */
export function merge(a: TaskDocument, b: TaskDocument): MergeResult {
  // validate() returns fresh copies, so the repairs below can mutate freely.
  const x = validate(a);
  const y = validate(b);

  const doc: TaskDocument = {
    version: minor(x.version) >= minor(y.version) ? x.version : y.version,
    tasks: [],
  };
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (CORE_KEYS.has(key)) continue;
    const fromX =
      !Object.hasOwn(y, key) || (Object.hasOwn(x, key) && canonical(x[key]) >= canonical(y[key]));
    doc[key] = fromX ? x[key] : y[key];
  }
  if (x.lists || y.lists) doc.lists = mergeRecords(x.lists, y.lists);
  if (x.fields || y.fields)
    doc.fields = mergeRecords(x.fields, y.fields).map((f) => withOptions(f, x, y));
  doc.tasks = mergeRecords(x.tasks, y.tasks);

  const repairs: Repair[] = [];
  const lists = doc.lists ?? [];
  breakCycles(lists, "lists", "parentId", repairs);
  breakCycles(doc.tasks, "tasks", "parentId", repairs);
  breakCycles(doc.tasks, "tasks", "dependsOn", repairs);
  repairOptions(doc, repairs);
  repairValues(doc, repairs);

  // Re-validating proves the repairs covered every conflict; a throw here is a bug in merge().
  return { document: validate(doc), repairs };
}

const minor = (version: string): number => Number(version.split(".")[1]);

/** JSON with sorted keys, so equal content compares equal regardless of key order. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
      : v,
  ) ?? "";

/** Positive when `p` wins over `q`. */
function compare(p: Stamped, q: Stamped): number {
  // UTC strings differ in precision ("…:00Z" vs "…:00.000Z"), so compare padded keys, not raw text.
  const time = (r: Stamped): string =>
    r.updatedAt === undefined ? "" : sortKey(r.updatedAt.slice(0, -1));
  const [tp, tq] = [time(p), time(q)];
  if (tp !== tq) return tp > tq ? 1 : -1;
  const deleted = Number(p.deletedAt !== undefined) - Number(q.deletedAt !== undefined);
  if (deleted !== 0) return deleted;
  const [cp, cq] = [canonical(p), canonical(q)];
  return cp === cq ? 0 : cp > cq ? 1 : -1;
}

function mergeRecords<T extends Stamped>(a: readonly T[] = [], b: readonly T[] = []): T[] {
  const out = new Map<string, T>();
  for (const r of a) out.set(r.id, r);
  for (const r of b) {
    const prev = out.get(r.id);
    out.set(r.id, prev && compare(prev, r) >= 0 ? prev : r);
  }
  return [...out.values()];
}

/** The winning field definition with both sides' options merged one by one. */
function withOptions(field: FieldDefinition, x: TaskDocument, y: TaskDocument): FieldDefinition {
  const ox = x.fields?.find((f) => f.id === field.id)?.options;
  const oy = y.fields?.find((f) => f.id === field.id)?.options;
  return ox || oy ? { ...field, options: mergeRecords(ox, oy) } : field;
}

/** Removes the link held by the most recently edited member of each cycle, undoing the later move. */
function breakCycles<T extends Stamped & { parentId?: string; dependsOn?: string[] }>(
  items: T[],
  collection: string,
  key: "parentId" | "dependsOn",
  repairs: Repair[],
): void {
  const edges = (item: T): readonly string[] =>
    key === "dependsOn"
      ? (item.dependsOn ?? [])
      : item.parentId === undefined
        ? []
        : [item.parentId];
  for (let cycle = findCycle(items, edges); cycle; cycle = findCycle(items, edges)) {
    let pos = 0;
    for (let k = 1; k < cycle.length; k++)
      if (compare(items[cycle[k]!]!, items[cycle[pos]!]!) > 0) pos = k;
    const i = cycle[pos]!;
    const item = items[i]!;
    const target = items[cycle[(pos + 1) % cycle.length]!]!.id;
    if (key === "parentId") delete item.parentId;
    else {
      item.dependsOn = item.dependsOn!.filter((d) => d !== target);
      if (item.dependsOn.length === 0) delete item.dependsOn;
    }
    bump(item);
    repairs.push({
      path: [collection, i, key],
      message: `"${item.id}" ${key} → "${target}" closed a cycle`,
      removed: target,
    });
  }
}

/** Options merged in from one side may not fit the field definition that won from the other. */
function repairOptions(doc: TaskDocument, repairs: Repair[]): void {
  const resolved = resolveFields(doc);
  doc.fields?.forEach((f, i) => {
    if (!f.options || resolved[f.id]!.builtIn) return;
    const path = ["fields", i, "options"];
    if (f.type !== "select" && f.type !== "multiSelect") {
      repairs.push({ path, message: `"${f.id}" is no longer a select field`, removed: f.options });
      delete f.options;
      return;
    }
    const { categories } = f;
    for (const o of f.options) {
      if (!categories) {
        if (o.category === undefined) continue;
        repairs.push({
          path,
          message: `"${f.id}" has no categories anymore; option "${o.id}" lost its category`,
          removed: o.category,
        });
        delete o.category;
        bump(o);
      } else if (
        o.deletedAt === undefined &&
        (o.category === undefined || !categories.includes(o.category))
      ) {
        // Deleted rather than dropped: the marker wins later merges, and values using the option stay valid.
        repairs.push({
          path,
          message: `option "${o.id}" has category "${o.category}", which "${f.id}" no longer has; marked deleted`,
          removed: o.category,
        });
        bump(o);
        o.deletedAt = o.updatedAt;
      }
    }
  });
}

/**
 * A repaired record must beat both copies it came from, or merging a stale copy again would undo the repair.
 * One millisecond past its own stamp is deterministic, so every device produces the same repaired record.
 */
function bump(record: Stamped): void {
  record.updatedAt = Temporal.Instant.from(record.updatedAt!).add({ milliseconds: 1 }).toString();
}

/** Values set against an older version of their field definition. */
function repairValues(doc: TaskDocument, repairs: Repair[]): void {
  const fields = resolveFields(doc);
  doc.tasks.forEach((t, i) => {
    if (!t.values) return;
    let changed = false;
    for (const [key, value] of Object.entries(t.values)) {
      const field = fields[key];
      const error = field ? valueError(field, value) : `unknown field "${key}"`;
      if (error === undefined) continue;
      repairs.push({ path: ["tasks", i, "values", key], message: error, removed: value });
      delete t.values[key];
      changed = true;
    }
    if (changed) bump(t);
    if (Object.keys(t.values).length === 0) delete t.values;
  });
}
