# Tasks format 1.0

One document format for todos, calendar events and timelines. A todo, an event and a timeline bar are the same object, a **task**; which one it is depends only on which time fields it has. Field names and meanings follow [JSCalendar (RFC 8984)](https://www.rfc-editor.org/rfc/rfc8984) where they overlap, so conversion stays mechanical.

A document can be written as JSON, YAML or TOML; the data model is identical. Every date and time is a string in the data model: unquoted YAML dates and native TOML date/time values are read as the equivalent string (TOML `2026-11-10T09:30:00` → `"2026-11-10T09:30:00.000"`). TOML has no `null`, so a document holding one can't be written as TOML.

## Document

```yaml
version: "1.0"
lists: [] # optional
fields: [] # optional
tasks: []
```

| Key       | Type               | Required | Notes                                                 |
| --------- | ------------------ | -------- | ----------------------------------------------------- |
| `version` | string             | yes      | `"1.<minor>"`. Readers reject other majors.           |
| `lists`   | [List](#list)[]    | no       | Containers: todo lists, calendars, timeline projects. |
| `fields`  | [Field](#fields)[] | no       | Custom fields, and options added to built-in ones.    |
| `tasks`   | [Task](#task)[]    | yes      |                                                       |

Every object in the format keeps keys it doesn't define. Readers must write unknown keys back unchanged.

## Value types

| Name          | Example                                | Rules                                                                                                      |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Id            | `"7f3a2c…"`                            | Non-empty string, unique within its collection. UUIDs recommended for anything synced.                     |
| LocalDate     | `"2026-11-09"`                         | A real calendar date. As a task time it means all-day.                                                     |
| LocalDateTime | `"2026-11-09T10:00"`, `"…T10:00:30.5"` | No offset, no `Z`. Read in the task's `timeZone`; without one it floats (same wall-clock time everywhere). |
| UTCDateTime   | `"2026-11-09T10:00:00Z"`               | Always UTC with `Z`. Used for bookkeeping times.                                                           |
| Duration      | `"PT1H30M"`, `"P1D"`, `"P2W"`          | ISO 8601 without years or months (they have no fixed length).                                              |
| TimeZone      | `"Europe/Berlin"`                      | IANA name. Offsets like `+01:00` are not time zones.                                                       |
| Color         | `"#3b82f6"`                            | `#rrggbb` only, so every platform can read it.                                                             |

## Sync bookkeeping

Lists, custom fields, field options and tasks are **synced records**:

| Key         | Type        | Required | Notes                                                                  |
| ----------- | ----------- | -------- | ---------------------------------------------------------------------- |
| `id`        | Id          | yes      |                                                                        |
| `updatedAt` | UTCDateTime | yes      | Set on every change. Merging keeps the record with the later value.    |
| `deletedAt` | UTCDateTime | no       | Marks the record deleted. It stays in the document so references hold. |

A deleted record is still a valid reference target. Apps show it as archived or hide it.

### Merging

Two copies of a document merge record by record, so any implementation reaches the same content:

1. Records match by `id` within lists, tasks, custom fields, and each field's options. A record only one side has is kept.
2. The record with the later `updatedAt` instant wins whole. Compare instants, not text: `…:00Z` equals `…:00.000Z`.
3. On equal instants, a record with `deletedAt` wins; otherwise the one whose JSON with keys sorted is larger, comparing UTF-16 code units.
4. A field definition's options merge one by one, independently of which definition won. Built-in field entries have no `updatedAt`, so only their options matter.
5. Unknown top-level keys follow rule 3's JSON comparison. `version` takes the higher minor.

Two valid copies can still combine into an invalid document. Repair it like this and tell the user what was removed:

- **Cycles** in `parentId` or `dependsOn` (tasks) or `parentId` (lists): within the loop, find the record that wins by rules 2–3 and remove its link to the next record. This undoes the later move.
- **Options** that don't fit the winning field definition: drop every option when the field is no longer a select; mark deleted an option whose category the field no longer has (values using it stay valid); remove `category` from options when the field has no categories anymore.
- **Values** that no longer fit their field (type or range): remove them from `values`.

Every record a repair changes gets `updatedAt` one millisecond later than its own. The repaired version then wins against both copies it came from, so merging a stale copy again doesn't undo the repair, and every device still computes the same result.

Order is not synced: a merged collection keeps the first copy's order and appends records only the second copy has.

## List

| Key        | Type   | Required | Notes                                |
| ---------- | ------ | -------- | ------------------------------------ |
| `title`    | string | yes      |                                      |
| `color`    | Color  | no       |                                      |
| `parentId` | Id     | no       | Another list; lists nest. No cycles. |

## Task

| Key             | Type                           | Notes                                                                                                                                                                                        |
| --------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`         | string                         | Required.                                                                                                                                                                                    |
| `notes`         | string                         |                                                                                                                                                                                              |
| `listId`        | Id                             | Must name a list.                                                                                                                                                                            |
| `parentId`      | Id                             | Parent task (subtask). No cycles.                                                                                                                                                            |
| `dependsOn`     | Id[]                           | Tasks that must finish first. No cycles.                                                                                                                                                     |
| `start`         | LocalDate \| LocalDateTime     |                                                                                                                                                                                              |
| `end`           | LocalDate \| LocalDateTime     | Needs `start`, same form as `start`, not before it. Excludes `duration`. A date `end` is inclusive (`start: 2026-11-10, end: 2026-11-12` is three days); a date-time `end` is the exact end. |
| `duration`      | Duration                       | Needs `start`. All-day starts take whole days or weeks only. Days are calendar days, hours are elapsed time (a DST change can shift the end's wall-clock time).                              |
| `due`           | LocalDate \| LocalDateTime     |                                                                                                                                                                                              |
| `timeZone`      | TimeZone                       | Applies to every local time on the task. Absent: floating.                                                                                                                                   |
| `recurrence`    | [Recurrence](#recurrence)      | Needs `start` or `due`.                                                                                                                                                                      |
| `excludedDates` | (LocalDate \| LocalDateTime)[] | Occurrences to skip. Needs `recurrence`; same form as the anchor.                                                                                                                            |
| `completedAt`   | UTCDateTime                    |                                                                                                                                                                                              |
| `values`        | object                         | Field id → value. See [Fields](#fields).                                                                                                                                                     |

### Kind

A task's kind is never stored. Apps derive it:

| Time fields                       | Kind     | Typically shown as              |
| --------------------------------- | -------- | ------------------------------- |
| `start` and (`end` or `duration`) | `span`   | Calendar event, timeline bar    |
| `start` only                      | `moment` | Milestone                       |
| no `start`                        | `todo`   | Reminder, optionally with `due` |

Any app can show any task. A todo app can list events; a calendar can place todos on their `due` date.

### Recurrence

The rule repeats the task's anchor: `start`, or `due` when there is no `start`. Unknown keys are an error here, because silently ignoring one would change which dates recur.

| Key          | Type                                   | Notes                                                                                  |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `freq`       | `daily \| weekly \| monthly \| yearly` | Required.                                                                              |
| `interval`   | integer ≥ 1                            | Every n-th period. Default 1.                                                          |
| `byDay`      | `{ day, nth? }[]`                      | `day`: `mo tu we th fr sa su`. `nth` (±1…53, `-1` = last) only with monthly or yearly. |
| `byMonthDay` | integer[]                              | ±1…31; negative counts from the month's end.                                           |
| `byMonth`    | integer[]                              | 1…12.                                                                                  |
| `count`      | integer ≥ 1                            | Total occurrences. Excludes `until`.                                                   |
| `until`      | LocalDate \| LocalDateTime             | Last possible occurrence, inclusive. Same form as the anchor.                          |

Expanding a rule:

- The anchor is always the first occurrence, even if the rule wouldn't produce it.
- Weeks start on Monday.
- Dates that don't exist are skipped, not moved: the 31st in a 30-day month, 29 February outside leap years.
- Occurrences keep the anchor's wall-clock time in `timeZone`. A time skipped by a DST change moves forward by the gap (02:30 → 03:30).
- `count` includes occurrences removed by `excludedDates`.
- `end` and `due` move with each occurrence by their offset from `start`.

Completing a recurring todo moves its anchor to the next occurrence.

## Fields

Everything that describes a task lives in `values`, keyed by field id. Statuses, priorities and tags are fields like any custom one; they just come predefined.

```yaml
fields:
  - id: status # built-in: add options or rename existing ones
    options:
      - { id: shipped, title: "Shipped 🚀", color: "#22c55e", category: done, updatedAt: … }
  - id: stage # custom
    title: Pipeline stage
    type: select
    categories: [lead, active, closed]
    options:
      - { id: proposal, title: Proposal sent, category: lead, updatedAt: … }
    updatedAt: …
tasks:
  - id: …
    title: Ship invoice
    values: { status: shipped, priority: high, tags: [billing], stage: proposal }
    updatedAt: …
```

### Field definition

A custom field is a synced record.

| Key          | Type      | Notes                                                            |
| ------------ | --------- | ---------------------------------------------------------------- |
| `title`      | string    | Required for custom fields.                                      |
| `type`       | FieldType | Required for custom fields.                                      |
| `options`    | Option[]  | Select types only.                                               |
| `categories` | string[]  | Select types only. A fixed meaning every option maps to. Unique. |
| `open`       | boolean   | Select types only. Values outside `options` are allowed.         |
| `min`, `max` | number    | Number type only.                                                |

| FieldType     | Value                            |
| ------------- | -------------------------------- |
| `text`        | string                           |
| `number`      | finite number within `min`/`max` |
| `boolean`     | `true` / `false`                 |
| `date`        | LocalDate or LocalDateTime       |
| `url`         | absolute URL string              |
| `select`      | one option id                    |
| `multiSelect` | option ids, no duplicates        |

### Option

An option is a synced record.

| Key        | Type   | Notes                                                                                          |
| ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| `title`    | string | Required, except when renaming a built-in option.                                              |
| `color`    | Color  |                                                                                                |
| `category` | string | Required when the field has `categories`; must be one of them. Deleted options aren't checked. |

Every option merges on its own, so two devices adding options at the same time both keep theirs.

### Built-in fields

Always present. A document may list a built-in field only to add options to it, or to change a built-in option's `title` and `color` by reusing its id. Its type, categories and other settings are locked, built-in options keep their category and can't be deleted.

| Id         | Type        | Categories                  | Options                    |
| ---------- | ----------- | --------------------------- | -------------------------- |
| `status`   | select      | `todo doing done cancelled` | one per category, same ids |
| `priority` | select      | `low medium high`           | one per category, same ids |
| `tags`     | multiSelect | none, `open`                | none                       |
| `progress` | number      | 0–100                       |                            |
| `location` | text        |                             |                            |

Built-in categories are what other apps rely on: any app knows a task with status `shipped` is done because `shipped` maps to `done`. A task without a status counts as `todo`.

## Markdown task files

A Markdown file can hold one task. Its frontmatter, YAML between `---` lines or TOML between `+++` lines starting on the first line, has a `task` object; the body after the closing fence is the task's `notes`, byte for byte. Other frontmatter keys belong to the note and are kept.

```markdown
---
aliases: [invoice]
task:
  id: invoice
  title: Ship invoice
  due: 2026-11-12
  values: { status: todo }
  updatedAt: 2026-11-09T10:00:00Z
---

# Ship invoice

- [ ] attach PDF
```

- `task.notes` must not appear in the frontmatter; the body is the notes.
- A file is a task file exactly when its frontmatter has a `task` object; an invalid task is still a task file.
- A file on its own is checked for the task's shape and time rules. References and `values` need the other tasks and the field definitions, so they're checked once the tasks form a document.

## iCalendar mapping

Informative. How `toICS`/`fromICS` map to RFC 5545; other implementations should map the same way.

A task exports as a **VEVENT** when it has `start`, no `due`, and no status other than `cancelled`; otherwise as a **VTODO**. Deleted tasks are skipped.

| Task                                | iCalendar                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                                | `UID`                                                                                                        |
| `updatedAt`                         | `LAST-MODIFIED` and `DTSTAMP`. Import prefers `LAST-MODIFIED`; neither → `1970-01-01T00:00:00Z`              |
| `title`, `notes`, `values.location` | `SUMMARY`, `DESCRIPTION`, `LOCATION`                                                                         |
| `start`, `due`                      | `DTSTART`, `DUE`, with `VALUE=DATE` for dates and `TZID=<IANA>` from `timeZone`. `timeZone: UTC` writes `…Z` |
| `end`                               | VEVENT `DTEND`, one day later for dates (iCalendar ends are exclusive). VTODO: `DURATION`                    |
| `duration`                          | `DURATION`                                                                                                   |
| status category                     | `STATUS`: todo `NEEDS-ACTION`, doing `IN-PROCESS`, done `COMPLETED`, cancelled `CANCELLED`                   |
| priority category                   | `PRIORITY`: high 1, medium 5, low 9. Import: 1–4 high, 5 medium, 6–9 low                                     |
| `values.progress`, `completedAt`    | VTODO `PERCENT-COMPLETE`, `COMPLETED`                                                                        |
| `values.tags`                       | `CATEGORIES`                                                                                                 |
| `parentId`                          | `RELATED-TO;RELTYPE=PARENT` (the default `RELTYPE`)                                                          |
| `dependsOn`                         | `RELATED-TO;RELTYPE=DEPENDS-ON` (RFC 9253). Import also reads `FINISHTOSTART` from the predecessor           |
| `recurrence`, `excludedDates`       | `RRULE`, `EXDATE`. `UNTIL` is written in UTC when the task has a time zone                                   |

Time zones are referenced by IANA name without `VTIMEZONE` blocks (RFC 7809). On import, every time is converted to the zone of `DTSTART` (or `DUE`).

**Lost on export:** lists, custom fields, custom status and priority options (exported as their category), unknown keys, deleted tasks.

**Dropped on import, and reported:**

- whole components: `RRULE` parts other than `FREQ` (daily to yearly), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, and `WKST` (`WKST` is dropped only where it changes results); changed occurrences (`RECURRENCE-ID`); TZIDs that aren't IANA names; components that break a rule of this spec
- single properties: `RDATE`, and relations to tasks not in the file

Ignored on import: alarms, attendees, and other properties without a counterpart.

## Validity

A reader must reject a document that breaks any rule above and should report each problem with its path (e.g. `tasks.3.values.status`). A value in `values` whose key names no field is an error.
