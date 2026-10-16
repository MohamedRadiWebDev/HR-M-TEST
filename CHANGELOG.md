# Changelog

## 3.1.0
- **Employee portal + HR side (local):** requests with approval chain (manager → manager's manager → HR) that turn into attendance effects on final approval; leave balances; overtime detected from punches as approval requests; payroll (salary profiles, payslips, loans with instalment schedule, bonuses, deductions with objection flow); custody; documents; announcements + occasions; surveys (optionally anonymous); notifications; calendar; "view as" switcher.
- New `usePortalStore` persisted through `src/data/storage.ts`, included in backups ("portal" module).
- 25 new tests covering approvals, request→effects, balances, overtime, payroll, loans, deductions and portal backup.

## 3.0.0
- **Migrated from Vite to Next.js 16 (App Router, static export) on React 19.** No server and no database: everything stays local. Source moved from `client/src` to `src` (`views/` = screens, `app/` = routes).
- Dropped `wouter` (navigation via `@/lib/nav`), `react-day-picker` (unused) and every server/Docker file added in 2.1.
- Employee profile is now `/employees/view?code=…` (static export cannot pre-render unknown codes).
- **Payroll month setting** (default 24 → 23) with a payroll-month picker + new Settings page; late policy (15 min grace, >15 ¼, >30 ½, >60 1 day) shown and boundary-tested.
- **`src/data/storage.ts`**: single seam for persistence so local storage can later be replaced by a database.

## 2.0.0

### Correctness
- **Time zone / DST**: punches are floating wall-clock values; removed the `getTimezoneOffset()` of "now" that shifted historical data by one hour in summer (and made Import and Attendance disagree).
- **Per-employee shift**: `employee.shiftStart` is now used for lateness, early leave and overtime (it was ignored); the import template/pipeline reads it.
- **Lone punch** after the shift midpoint is a forgotten check-in (+ "سهو بصمة دخول") instead of a late arrival.
- **Termination / hire / birth dates** are normalised day-first (Arabic digits, Excel serials, JS-Date text); `05/03/2026` is 5 March, never 3 May.
- **Excel export**: every status has an Arabic label; one `summarizePenalties` for detail, summary and dashboard; formulas carry cached results; absence weighting applied consistently; excused absence no longer silently counted in one sheet only.
- Rules: unknown scope prefix no longer matches everybody; comma lists (incl. Arabic comma) supported for dept/sector.
- Effects: undo/redo fixed; deleting/editing an effect removes its impact (no ghost adjustments); "إذن عام" supported; unknown types noted in Arabic; effect changes (incl. quick-add) re-sync attendance for exactly the affected days.
- Store: unique holiday ids; employee upsert on re-import; dedupe + validation for adjustments/leaves/rules; code rename cascades; holiday-attendance toggle keeps comp-day fields consistent; reprocessing refuses to run with no punches loaded.
- Attendance page: sector filter + pagination now correct, "smart reprocess" uses all filtered employees, deep links work, date inputs commit only complete dates, rows virtualised with measured heights, mobile and desktop DOM no longer both rendered.

### Persistence & backup
- IndexedDB persistence (no 5 MB limit), **punches are persisted**, effects are persisted/backed up/wiped with everything else, incompatible data is never overwritten, auto-backup is debounced and stored in IndexedDB.
- Backup v2: real compression (fflate), optional AES-256-GCM encryption, schema validation, merge without id collisions, automatic pre-restore snapshot + one-click undo.

### Performance
- Engine is O(punches) instead of O(employees × punches) (600 employees × 30 days: ~5 s → well under 1 s) and runs in a Web Worker.

### Security / hygiene
- Removed committed personal data (`attached_assets/`) and a stale project tarball; `.gitignore` hardened.
- Removed SheetJS (`xlsx`), drizzle/pg ORM from the browser bundle, unused packages, and the dead REST/drizzle files; fixed critical/high advisories except the Tailwind v3 build-time chain.
- Fonts self-hosted; no external requests; `lang="ar" dir="rtl"`, title, zoom enabled.
- Personal fields masked in the employees UI.

### Tooling
- Tests are type-checked, `vitest.config.ts` runs `shared/` tests too, CI uses `npm ci` + check + test + build, Replit deploy config fixed (static).
