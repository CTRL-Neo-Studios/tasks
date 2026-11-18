import { type Fields, isOpen } from "./predicates";
import { sortKey, type Task, type TaskDocument, type View } from "./schema";

/**
 * The tasks a view shows, in its order: not deleted, in its `listIds` or lists nested in them, open ones only
 * with `openOnly`, sorted by `sortBy`. Tasks without the value come last either way; ties keep document order.
 * Grouping (`groupBy`) is the app's to draw.
 */
export function viewTasks(doc: TaskDocument, view: View, fields: Fields): Task[] {
  const lists = view.listIds && nested(doc, view.listIds);
  const shown = doc.tasks.filter(
    (t) =>
      t.deletedAt === undefined &&
      (!lists || (t.listId !== undefined && lists.has(t.listId))) &&
      (!view.openOnly || isOpen(t, fields)),
  );
  if (view.sortBy === undefined) return shown;
  const [get, compare] = sorter(view.sortBy, fields);
  const sign = view.sortDescending ? -1 : 1;
  const keyed = shown.map((task) => ({ task, key: get(task) }));
  // Stable, so ties keep document order.
  keyed.sort((p, q) =>
    p.key === undefined || q.key === undefined
      ? Number(p.key === undefined) - Number(q.key === undefined)
      : sign * compare(p.key, q.key),
  );
  return keyed.map((k) => k.task);
}

type Key = string | number;
type Sorter = [get: (t: Task) => Key | undefined, compare: (a: Key, b: Key) => number];

const words = new Intl.Collator(undefined, { numeric: true });
const byWords = (a: Key, b: Key): number => words.compare(a as string, b as string);
const byNumber = (a: Key, b: Key): number => (a as number) - (b as number);
const byCode = (a: Key, b: Key): number => (a < b ? -1 : a > b ? 1 : 0);
/** Local and UTC times as comparable text: padded, `Z` dropped. */
const time = (v: unknown): string | undefined =>
  typeof v === "string" ? sortKey(v.replace(/Z$/, "")) : undefined;
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function sorter(key: string, fields: Fields): Sorter {
  if (key === "title") return [(t) => t.title, byWords];
  if (key === "starred") return [(t) => Number(t.starred === true), byNumber];
  if (!key.startsWith("values.")) return [(t) => time(t[key]), byCode];
  const id = key.slice("values.".length);
  const field = fields[id]!;
  const value = (t: Task) => t.values?.[id];
  switch (field.type) {
    case "number":
      return [(t) => value(t) as number | undefined, byNumber];
    case "boolean":
      return [(t) => (value(t) === undefined ? undefined : Number(value(t))), byNumber];
    case "date":
      return [(t) => time(value(t)), byCode];
    case "select": {
      // Option order; a value outside the options (an open field) after them.
      const rank = new Map(field.options.map((o, i) => [o.id, i]));
      return [
        (t) => (value(t) === undefined ? undefined : (rank.get(value(t) as string) ?? rank.size)),
        byNumber,
      ];
    }
    default:
      return [(t) => text(value(t)), byWords];
  }
}

/** `ids` and every list nested under one of them. */
function nested(doc: TaskDocument, ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of doc.lists ?? []) {
      if (l.parentId !== undefined && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}
