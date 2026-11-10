import { Temporal } from "temporal-polyfill";
import type { ResolvedField, Task, UTCDateTime } from "./schema";

/** What a task's status means, whatever its option is called. */
export type TaskStatus = "todo" | "doing" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";
/** Output of `resolveFields(doc)`; resolve once and reuse it across tasks. */
export type Fields = Record<string, ResolvedField>;

/** The status category: `shipped` → `done` if the document maps it so. No status means `todo`. */
export function statusOf(task: Task, fields: Fields): TaskStatus {
  const id = task.values?.["status"];
  return (
    (fields["status"]!.options.find((o) => o.id === id)?.category as TaskStatus | undefined) ??
    "todo"
  );
}

/** The priority category, or undefined when the task has none. */
export function priorityOf(task: Task, fields: Fields): TaskPriority | undefined {
  const id = task.values?.["priority"];
  return fields["priority"]!.options.find((o) => o.id === id)?.category as TaskPriority | undefined;
}

/** Status means done. Cancelled tasks aren't complete. */
export function isComplete(task: Task, fields: Fields): boolean {
  return statusOf(task, fields) === "done";
}

/** Still to do: not deleted, and status `todo` or `doing`. */
export function isOpen(task: Task, fields: Fields): boolean {
  const status = statusOf(task, fields);
  return task.deletedAt === undefined && (status === "todo" || status === "doing");
}

export interface OverdueOptions {
  /** Default: the current time. */
  now?: Date | UTCDateTime;
  /** The viewer's zone, for all-day and floating due times. Default: the runtime's zone. */
  timeZone?: string;
}

/**
 * The task is open and its `due` has passed. An all-day due date is overdue once its day is over in the
 * viewer's zone; a timed one once that moment passes, in the task's `timeZone` if it has one.
 */
export function isOverdue(task: Task, fields: Fields, options: OverdueOptions = {}): boolean {
  const { due } = task;
  if (due === undefined || !isOpen(task, fields)) return false;
  const now = options.now ?? new Date();
  const instant = Temporal.Instant.from(typeof now === "string" ? now : now.toISOString());
  const allDay = !due.includes("T");
  const zone =
    (allDay ? undefined : task.timeZone) ?? options.timeZone ?? Temporal.Now.timeZoneId();
  const wall = instant.toZonedDateTimeISO(zone).toPlainDateTime();
  return allDay
    ? Temporal.PlainDate.compare(wall.toPlainDate(), Temporal.PlainDate.from(due)) > 0
    : Temporal.PlainDateTime.compare(wall, Temporal.PlainDateTime.from(due)) > 0;
}

/** The tasks in `dependsOn` still in the way: not done, not cancelled, not deleted. Empty when unblocked. */
export function blockers(task: Task, tasks: readonly Task[], fields: Fields): Task[] {
  const ids = new Set(task.dependsOn);
  return ids.size === 0 ? [] : tasks.filter((t) => ids.has(t.id) && isOpen(t, fields));
}
