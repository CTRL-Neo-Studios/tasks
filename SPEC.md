# Tasks format 1.0

One document format for todos, calendar events and timelines. A todo, an event and a timeline bar are the same object, a **task**; which one it is depends only on which time fields it has. Field names and meanings follow [JSCalendar (RFC 8984)](https://www.rfc-editor.org/rfc/rfc8984) where they overlap, so conversion stays mechanical.

A document can be written as JSON, YAML or TOML; the data model is identical.

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

## List

| Key        | Type   | Required | Notes                                |
| ---------- | ------ | -------- | ------------------------------------ |
| `title`    | string | yes      |                                      |
| `color`    | Color  | no       |                                      |
| `parentId` | Id     | no       | Another list; lists nest. No cycles. |

## Task

| Key             | Type                           | Notes                                                                    |
| --------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `title`         | string                         | Required.                                                                |
| `notes`         | string                         |                                                                          |
| `listId`        | Id                             | Must name a list.                                                        |
| `parentId`      | Id                             | Parent task (subtask). No cycles.                                        |
| `dependsOn`     | Id[]                           | Tasks that must finish first. No cycles.                                 |
| `start`         | LocalDate \| LocalDateTime     |                                                                          |
| `end`           | LocalDate \| LocalDateTime     | Needs `start`, same form as `start`, not before it. Excludes `duration`. |
| `duration`      | Duration                       | Needs `start`. All-day starts take whole days or weeks only.             |
| `due`           | LocalDate \| LocalDateTime     |                                                                          |
| `timeZone`      | TimeZone                       | Applies to every local time on the task. Absent: floating.               |
| `recurrence`    | [Recurrence](#recurrence)      | Needs `start` or `due`.                                                  |
| `excludedDates` | (LocalDate \| LocalDateTime)[] | Occurrences to skip. Needs `recurrence`; same form as the anchor.        |
| `completedAt`   | UTCDateTime                    |                                                                          |
| `values`        | object                         | Field id → value. See [Fields](#fields).                                 |

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

Weeks start on Monday. Completing a recurring todo moves its anchor to the next occurrence.

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

| Key        | Type   | Notes                                                          |
| ---------- | ------ | -------------------------------------------------------------- |
| `title`    | string | Required, except when renaming a built-in option.              |
| `color`    | Color  |                                                                |
| `category` | string | Required when the field has `categories`; must be one of them. |

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

## Validity

A reader must reject a document that breaks any rule above and should report each problem with its path (e.g. `tasks.3.values.status`). A value in `values` whose key names no field is an error.
