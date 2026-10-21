# Design

## Context
Greenfield. The model is in `docs/core/ARCHITECTURE.md`; this change realises it. Constraints:
- plain JS ES modules with JSDoc + `// @ts-check`;
- zero dependencies; Node ≥ 24;
- tests with `node:test`;
- the code must also run in a Cloudflare Worker and in browsers (Electron renderer, Android
  Chrome), so no Node-only APIs in `packages/core` (`Intl` and `Date` only).

## Goals / Non-Goals
**Goals:** one pure module set that every placement imports for the model, schedule semantics,
URL tokens, validation, ordering, defaults resolution and merging; plus the seed dataset.

**Non-Goals:** I/O, persistence, HTTP, DOM, Electron. Streak and history statistics are deferred
to the UI changes.

## Decisions

### Model delta (objects and morphisms)
Objects (JSDoc typedefs in `packages/core/model.js`):
```
Schedule   = {type:'daily'}
           | {type:'weekly', weekday:1..7}
           | {type:'monthly', day:1..31}
           | {type:'everyNDays', n:int≥1, startDate:'YYYY-MM-DD'}
Workspace  = {id, name, icon:string|null, order:int, sleepAfterMin:int≥0 (0=never),
              openInEdge:boolean, updatedAt:int (epoch ms), deleted:boolean}
Group      = {id, workspaceId, name, order:int, collapsed:boolean, updatedAt, deleted}
Item       = {id, workspaceId, groupId:string|null, order:int, name, icon:string|null,
              kind:'web'|'app', url:string|null, appPath:string|null, fallbackUrl:string|null,
              devices:'all'|'desktop'|'phone', schedule:Schedule|null, resetTime:'HH:MM',
              notify:boolean, badge:boolean,
              edge:{mode:'inherit'|'never'|'always', profile:string|null},
              isolate:boolean, persistSessionCookies:boolean,
              sleepAfterMin:int≥0|null (null=inherit), updatedAt, deleted}
Completion = {itemId, periodKey:'YYYY-MM-DD', doneAt:int}
Settings   = {timezone:string (IANA), googleEmail:string|null, updatedAt}
```
§3 consolidation check:
- **No new `CheckIn` object.** A check-in is an `Item` with `schedule ≠ null`.
- **`Workspace.openInEdge` is new on an existing object.** It is not a new object. It realises
  "per-workspace Edge default, per-item override" (Q14).
- **`Group` is kept separate from `Workspace`.** Its morphisms differ: no sleep, no Edge default,
  no layout.

Morphisms (signatures; all pure, `now` is always a parameter):
```
localParts(nowMs, tz)              → {date:'YYYY-MM-DD', minutes:int}         time.js
effectiveDay(nowMs, tz, resetTime) → 'YYYY-MM-DD'                              time.js
addDays(date, n) / daysInMonth(y,m) / isoWeekday(date) / isValidDate(date)    time.js
periodKey(schedule, nowMs, tz, resetTime='00:00') → 'YYYY-MM-DD' | null       schedule.js
nextPeriodStart(schedule, periodKey) → 'YYYY-MM-DD'                            schedule.js
bucket(item, completions, nowMs, tz) → 'due'|'done'|'notDue'|null             schedule.js
nextDue(item, completions, nowMs, tz) → 'YYYY-MM-DD' | null                   schedule.js
expandUrl(template, nowMs, tz, settings) → {url, unknown:string[], missing:string[]}  url-tokens.js
validateItem(item, {groups?}) → {field:string, code:string}[]                 model.js
effectiveSleep(item, workspace) → int (0 = never)                              model.js
effectiveEdge(item, workspace, deviceDefaultProfile|null) → {open:boolean, profile:string|null}  model.js
moveItem(item, toWorkspaceId, nowMs) → Item                                   model.js
reorder(siblings, id, toIndex, nowMs) → entity[]                              order.js
mergeLww(a[], b[]) → entity[]                                                 sync.js
SEED → {workspaces, groups, items, settings}                                  seed.js
```

### Time handling
- `Intl.DateTimeFormat('en-CA', {timeZone, year, month, day, hour, minute, hourCycle:'h23'})`
  `.formatToParts` gives the local wall-clock parts.
- **Effective day:** if `hour*60+minute < reset minutes`, the effective day is the previous civil
  day.
- **Civil-date arithmetic** works on `'YYYY-MM-DD'` strings via `Date.UTC`, so DST never affects
  it.
- **Unknown timezone:** throws `RangeError('invalid-timezone')`. It is not caught; this is a
  boundary error.
- `expandUrl` uses `localParts(now, tz).date`, without the reset time.

### bucket / nextDue
- `pk = periodKey(...)`. If the schedule is null → `null`.
- If `pk === null` → `'notDue'`.
- `c` = the completion with `itemId === item.id && periodKey === pk`.
- If there is no `c` → `'due'`.
- If `effectiveDay(c.doneAt, tz, item.resetTime) === effectiveDay(now, tz, item.resetTime)` →
  `'done'`, else `'notDue'`.
- **`nextDue`:**
  - `pk === null` → `schedule.startDate`;
  - due → `effectiveDay(now)`;
  - otherwise → `nextPeriodStart(schedule, pk)`. For monthly that is next month's
    `clamp(day)`, computed from the period's month rather than the clamped date. This avoids
    31→28→28 drift.

### mergeLww
- Key every entity by `id` (Settings uses the fixed id `'settings'`).
- For each id, keep the version with the greater `updatedAt`.
- **Tie-break:** the greater canonical JSON string (keys sorted). This is total, deterministic,
  commutative, associative and idempotent.
- Output is sorted by `id`.
- Tombstones (`deleted:true`) are ordinary versions, so they win only when newer.

### reorder
- Sort siblings by `order` and remove the moved one.
- Insert it at `clamp(toIndex, 0, len)` and re-number 0..n-1.
- Return new objects: entities whose `order` changed get `updatedAt = nowMs`, the rest are
  returned unchanged (same values).
- An unknown id returns a shallow copy, unchanged.

### Seed (example dataset, decision D54; editable later in the apps)
The shipped `SEED` is a generic example. Personal data goes in git-ignored
`config/seed.local.json` (same shape); see D54.
- **Workspaces:**
  - `ws-productivity`: "Productivity", sleep 0, openInEdge false.
  - `ws-daily`: "Daily", sleep 10, openInEdge false.
- **Groups (Daily):** `g-study` "Study", `g-perks` "Perks", `g-fun` "Fun".
- **Productivity items:** no schedule; notify/badge true; devices `all`.
  - `it-gcal` Google Calendar: `https://calendar.google.com/calendar/r?authuser={googleEmail}`
  - `it-mail` Mail: `https://mail.example.com`
  - `it-tasks` Tasks: `https://tasks.example.com/today`
  - `it-notes` Notes: `https://notes.example.org`
- **Daily items:** scheduled; notify/badge false; devices `all` except where noted.
  - Study: `it-language` Language practice `https://learn.example.org/daily` (daily);
    `it-coding` Coding lessons `https://code.example.org/learn` (daily).
  - Perks: `it-rewards` Rewards `https://rewards.example.com` (daily);
    `it-monthly-shop` "Monthly shop (example)" `https://example.com/shop/{YYYY}{MM}` (monthly, day 1).
  - Fun: `it-word-game` Word game `https://games.example.net/word` (daily);
    `it-weekly-bonus` "Weekly bonus (example)" `https://example.com/bonus-weekly` (weekly,
    weekday 1); `it-every-3-days` "Every 3 days (example)" `https://example.com/bonus`
    (everyNDays n 3, startDate `2026-01-01`, devices `desktop`).
- **All items:** `kind:'web'`, `resetTime:'00:00'`, `edge:{mode:'inherit',profile:null}`,
  `isolate:false`, `persistSessionCookies:true`, `sleepAfterMin:null`, `icon:null`,
  `updatedAt:0`, `deleted:false`.
- **Total:** 11 items (4 productivity + 7 daily).
- **Order:** the order listed above within each group or workspace (dense per parent).
- **Settings:** `{timezone:'UTC', googleEmail:null, updatedAt:0}`.

### Coherence laws kept
- **Law 6 (`runsAt` is a relation):** the module is placed at the Worker, desktop and phone, and
  it is pure, so the placements cannot disagree.
- **Law 1 (placement honesty):** no ambient reads (no `Date.now()` or `process` inside core).
  `now`, `tz` and the completions are always passed in.

## Risks / Trade-offs
- **`Intl` timezone data.** It differs slightly between runtimes (Workers vs Chrome vs Node).
  Only fixed-offset or simple zones matter in v1 (tests use Asia/Tokyo, which has no DST; DST zones are covered by a sweep over America/New_York).
- **Monthly clamp anchored on the period's month.** A day-31 schedule yields 01-31, 02-28,
  03-31, by design (tested).
- **Canonical-JSON tie-break.** Arbitrary but deterministic; ties need identical-millisecond
  edits, so they are rare.
