# AUDIT – My Sales Desk UAE v2.0 → Employment Performance & Work Evidence Management System

Audit date: 23 Oct 2026 (Asia/Dubai). Baseline: git `881b5e2` (app v2.0, IndexedDB schema v2 = Dexie `version(2)` / IDB version 20). No code changed in this step.

## 0. Data-safety status (confirmed)

* The app has **never been deployed**. No hosting config, deploy scripts or host CLIs are present, and git has only two local commits (`v1 baseline`, `v2`). The only server is a local `sirv` on port 4173 on this box.
* Data exists only in browser profiles on this box: Playwright's throw-away test contexts, plus any manual visits to `localhost:4173`. All of it is fictional demo or test data. **No real user data exists anywhere.**
* Even so, the migration will be written as if real data existed: additive, with a backup taken automatically first, and tested.

## 1. Current architecture

Preact 10 + TypeScript + Vite 5 PWA (vite-plugin-pwa / Workbox precache, 32 files ≈ 4.6 MB), hash router, and a global in-memory store reloaded from IndexedDB (Dexie 4) after every write. All figures are derived by pure functions (`src/calc.ts`, `src/ledger.ts`, `src/lib/*`), never stored. There is a soft-void delete everywhere and a field-level before/after `auditLog`. Libraries: jsPDF + autotable, SheetJS 0.20.3 (CDN), ExcelJS, pdf.js, fflate. There is no backend and nothing paid.

**Tables (18):** customers, invoices, collections, allocations, grvs, creditNotes, deductions, statements (recon), followUps, importBatches, statementLines, targets, salesEntries, plans, tasks, jobRecords, auditLog, settings.

**Verdict: the architecture can support all 12 modules. Extend it in place; no rewrite or replacement is needed.** Reasons:
* IndexedDB stores Blobs natively, so evidence attachments fit.
* Dexie versioning gives additive migrations.
* The derived-calc design is exactly what drill-down and "no double count" need: every figure can return its source record ids.
* All exports (PDF/CSV/XLSX) already run offline.

Two scaling caveats:
* **Large attachments** count against the browser's storage quota, and iOS can evict data. Mitigations: `navigator.storage.persist()` (already requested), size limits, and an optional ZIP backup that includes the blobs.
* **The whole dataset is held in memory.** That is fine for one person's data (thousands of records), but attachment blobs must be loaded lazily and kept out of the in-memory store.

## 2. What works today (verified by automated tests on this box)

Test run on the current build: **unit 44/44**, **e2e 31 passed + 1 skipped** (Chromium mobile + WebKit iPhone profile; the screenshot test is skipped on WebKit by design). See §7 for the exact results of this audit run.

| Area | Verified behaviour |
|---|---|
| Customers / invoices | CRUD, TRN validation, a duplicate invoice number is blocked, VAT net↔gross (configurable rate, default 5%), due date = date + terms, edit history |
| Collections | Explicit allocation table, one payment across many invoices, on-account remainder, over-allocation is blocked, voiding a bounced cheque re-opens invoices, editing re-allocates |
| GRV / CN / deductions | GRV has no balance effect; only an Approved **and** Applied CN reduces a balance; only one CN per GRV; Disputed/Claimed deductions have no effect, Accepted/Partially Accepted do |
| Reconciliation | Statement balance vs recorded balance as at the date, with hints for the cause |
| Statement import | xlsx/xls/csv/text-PDF, flexible headers, validation preview, idempotent (SHA-256 + invoice no.), per-batch undo with before-images, statement snapshot lines, works offline |
| Statement export | Single and bulk statements as Excel or PDF (one file or ZIP), "Bisbelluk Trading LLC" header, opening/running/closing balance, allocations shown, read back with SheetJS and pdftotext |
| Targets / performance | Achievement, gap, projection, MoM/YoY, contribution, monthly plan vs actual, tasks with history |
| Alerts | In-app centre and badges, .ics export. Notifications are foreground-only and best-effort (documented) |
| My Job | Salary/allowances/kitha/claims (with a status, and reimbursement on the paid date)/loans/leave/documents/notes; ledger, monthly/yearly views, CSV/XLSX/PDF |
| Data | Validated JSON backup with a checksum (v1 and v2 accepted), atomic restore, wipe, migration v1→v2 tested (unit + e2e), offline reload/create/export |
| Search / audit | Global search across records, change history with field diffs |

## 3. Per-module gap analysis

Status key: ✅ = exists, 🟡 = partial, ❌ = missing.

| # | Module | Status | What exists | Missing / incomplete |
|---|---|---|---|---|
| 1 | Employment profile & timeline | 🟡 | `settings.companyName` and `jobStartDate`; `jobRecords` for target history, notes, leave and documents | No profile entity (employer, employee ID, designation, grade, department, manager, territory, contract type, end date, salary structure history). No role/territory/salary-change timeline view. No as-of employment status |
| 2 | Sales performance | 🟡 | Invoices (net/gross basis) + manual `salesEntries`; targets and performance | **No quotations, sales orders or returns as distinct documents, and no product lines.** "Net sales" is not defined (it should be invoiced − returns/CNs). Manual sales entries are **added on top of** invoices, which double-counts if a manual entry duplicates an invoice. Nothing links an order to an invoice, so "order + invoice" can't be de-duplicated. No product master and no product-level sales |
| 3 | Customer & billing records | ✅/🟡 | Customers, invoices, LPO, salesman, statement lines | No customer status/category/credit-limit history, no contact log, and no billing-address/TRN-change history beyond the audit log |
| 4 | Collection performance | 🟡 | Collections, allocations, follow-ups with promised date and amount, collection % | **The collection % denominator is ill-defined:** period collections ÷ (period invoiced − adjustments) mixes collections against old invoices with new billing, and can exceed 100% or be distorted. No collection-efficiency and no DSO/opening-receivable based ratios. **No broken-promise detection** (a promise past its date and not met). **No attribution flag:** perf attributes unallocated money to the customer's salesman automatically, and there is no "personally attributable / collected by me / handed over / company direct" field |
| 5 | GRV / CN / deductions / disputes registers | 🟡 | Separate GRV, CN and deduction tables with statuses; accepted vs claimed amounts | Not modelled as **claimed / approved / posted / recovered** amounts. The CN "applied" boolean ≈ posted, and there is no recovered amount. There is **no separate dispute register**: disputes are only a deduction status plus notes. No ageing of open claims. **Risk:** an Accepted deduction with no accepted amount falls back to the claimed amount (silent assumption) |
| 6 | Unpaid statements & reconciliation centre | 🟡 | Statement recon records, import snapshots, differences, hints | Only **two** balances (recorded vs customer statement). Needed: **three separate views**: company ledger (from an imported company SOA/ERP extract), customer statement (customer-confirmed), and my own computed balance, plus a three-way difference matrix, a control-centre list of unreconciled customers by age, and sign-off status |
| 7 | Personal earnings | 🟡 | Salary, incentive, bonus, allowance, deduction and kitha records with amounts | No **expected / earned / approved / paid / pending / disputed / unverified** lifecycle (records are single-state amounts). No incentive calculation from targets. **No EOSB estimate.** It must be separate, show its assumptions (UAE Labour Law basic-salary basis, 21/30 days per year, contract type, unpaid leave), and only be shown when the basic salary history and dates are complete |
| 8 | Work expenses register | 🟡 | Expense claims with status and reimbursement; other expense, fuel and phone records | No **personal vs company-paid** flag, no reimbursable flag, no receipt/evidence link, no "pending reimbursement" ageing. Kitha is treated as a personal outflow, which may need a "paid on behalf of company" option |
| 9 | Activities & achievements | 🟡 | Tasks, follow-ups, plans/visits, notes/achievements in My Job | No activity log entity (visit/call/meeting/new account/listing/promotion). **No verified vs self-claimed flag** and no link to evidence |
| 10 | Executive dashboard + drill-down | 🟡 | Home dashboard, performance dashboard, filters (period/customer/salesman) | **No drill-down from every figure to its underlying records.** Some figures link to lists, many don't. No single executive page across all 12 modules |
| 11 | Document & evidence register | ❌ | Document-expiry records only (metadata) | No attachments at all and no Blob storage. No evidence types (email, WhatsApp screenshot, signed SOA, delivery note, approval), no verification status, no linking to records, and no "not an official document" watermark/disclaimer. Backup doesn't cover blobs |
| 12 | Employment exit report | ❌ | Statement/report/job exports exist separately | No consolidated exit/period report. Needed: any period, as-of date, definitions, assumptions, a data-completeness section, PDF + CSV + Excel |
| – | Global search | 🟡 | Searches customers, invoices, collections, adjustments | Must extend to all new tables and evidence |
| – | Correction log | ✅ | Field-level audit with before/after on all tables | Add a reason-for-correction field and include evidence links |
| – | Validation flags | 🟡 | Per-form validation, duplicate warnings, recon hints | No **central data-quality flag list** (missing dates, duplicate refs, missing supporting record/evidence, bad/over allocations, unreconciled balances, stale promises) with counts that feed the report's completeness score |
| – | Tax / AED | ✅ | Configurable VAT % and currency (default AED 5%) | Keep it; make sure the new documents (quotations/orders/returns) use the same VAT engine |
| – | Offline-first / migration / backup | ✅ | Precache, IDB, versioned migration tested, validated backup | Needs v3 migration, an auto-backup before migration, and backup including blobs (ZIP) |
| – | Demo data | 🟡 | 8 demo customers plus the v2 seed | **The spec needs exactly five fictional customers** with multiple transactions across all modules → rewrite the seed and adjust the tests that assume 8 |

## 4. Bugs and risks found

1. **Possible double counting of sales.** `monthlyActuals` = invoices + manual `salesEntries`. If a user records a manual sale that later becomes an invoice, it is counted twice. Fix: a manual entry must be typed (e.g. "non-invoiced/cash van sale") or linked to an invoice; when linked, it is excluded.
2. **Order + invoice double count (future):** orders must never count as sales. Only invoices count, minus returns/CNs, and an order is linked to its invoice(s).
3. **Collection % denominator** mixes periods (see Module 4). Define and display explicit ratios:
   * period collection rate = collected in period ÷ (opening receivable + net billed in period)
   * invoice-cohort rate = collected against invoices billed in period ÷ net billed in period
   * collection vs target
4. **Attribution:** collections with no allocation are attributed automatically to the customer's salesman, with no user flag. This needs an explicit `attribution` field (`mine` / `shared` / `not-mine` / `unknown`), and "personally attributable" totals must only count `mine` (and `shared` × share %).
5. **Inconsistent sales basis:** the Home trend uses **gross** (incl. VAT) invoiced while Performance uses the setting (default **net**). Unify this, and label every figure "incl./excl. VAT".
6. **Silent assumption:** an Accepted deduction with acceptedAmount 0 uses claimedAmount. It should be flagged in validation.
7. **Statement table on mobile** (`StatementView`): 7 columns need horizontal scrolling at 402 px, so Debit/Credit/Balance are hidden off-screen (visible in `screenshots/14-statement.png`). Fix: a stacked card layout on narrow screens, or put the balance first with the details collapsed.
8. **The allocation audit entry shows raw invoice ids** (`{"invoiceId":"…"}`) instead of invoice numbers. This is cosmetic, but it matters for an "evidence" system.
9. **WebKit native form validation** blocked saving the plan form (fixed in v2 with `noValidate`). Other forms still rely on native validation, so audit them all and use `noValidate` with app-level validation consistently.
10. **Notifications** are foreground-only; there is no background push without a server (already documented). Not a bug, but the exit report and alerts must not depend on them.
11. **Storage eviction / attachments:** blobs increase the risk of hitting quota. Persistent storage must be requested and size shown, and a backup reminder must cover attachments.
12. **EOSB** must never be shown as an entitlement. Show it only as an estimate, with stated assumptions and completeness gating. The same applies to evidence, which is user-collected and not an official document.
14. **Repo hygiene:** `node_modules/` and `test-results/` are committed to git (there is no effective `.gitignore`). P1: add a `.gitignore` and untrack them. The source zip already excludes them.
13. **Real iOS Safari is untested** (only WebKit on Linux). This is still open.

## 5. Migration approach (schema v3)

* `db.version(3)`, **additive only**: new tables, plus new optional fields on existing records filled with defaults in `upgrade()`. Nothing is dropped or renamed. v1 → v2 → v3 is chained.
* **Auto-backup before migration:** on open, if the stored IDB version is below 20 → 30 and the DB has data, read every table with a raw IDB connection, write the full JSON backup into a separate `msd-premigration-backups` IndexedDB store (and offer it as a download), and only then open with Dexie. If the upgrade fails, Dexie rolls back the transaction and the app shows a restore option.
* **Default values for existing data:**
  * `collections.attribution = 'unknown'`, not assumed to be mine, and flagged for review.
  * `jobRecords` earnings `state = 'unverified'`, or 'paid' only where a paid date exists.
  * Expense `paidBy = 'personal'`.
  * Activities `verification = 'self-claimed'`.
* **Backup:** schema v3 JSON (v1 and v2 still restorable). Attachments go in an optional **ZIP backup** (JSON + `attachments/<id>` blobs + checksums). The JSON-only backup lists attachment metadata and warns that the files are excluded.
* **Tests:** migration from real v1 and v2 databases (unit + e2e), checking that every record survives, the pre-migration backup exists, and the defaults are applied.

New tables (proposed):
* `employmentProfile` / `employmentEvents` (role, territory and salary changes)
* `products`
* `quotations`, `salesOrders`, `docLines` (product lines for quotation/order/invoice/return)
* `salesReturns`
* `promises`, or followUps extended with outcome + kept/broken
* `disputes`
* `ledgerSnapshots` (company ledger balances)
* `earnings`, or jobRecords extended with state
* `expenses` (or jobRecords extended)
* `activities`
* `evidence` (metadata) + `evidenceBlobs` (Blob, lazy)
* `evidenceLinks`
* `flagsDismissed`

## 6. Prioritised phased plan

**P1 – Foundations and correctness (do first)**
1. Schema v3 migration framework + auto pre-migration backup + tests (v1 → v3, v2 → v3).
2. Fix the existing correctness risks: sales double count (typed/linked manual entries), a single sales basis with VAT labels, explicit collection-ratio definitions, the attribution flag on collections (default `unknown`) with personally-attributable totals, the deduction fallback flag, invoice numbers in the allocation audit, and `noValidate` everywhere.
3. A central **validation-flags engine** (missing dates, duplicate refs, missing supporting records, bad allocations, unreconciled balances, broken promises, missing evidence) plus a Data-quality screen. This feeds completeness scores everywhere.
4. A **drill-down contract**: every calc returns `{value, sourceIds}`, and a generic "records behind this figure" sheet. Fix the mobile statement layout.
5. New **five-customer fictional seed** covering all modules, and tests updated.

**P2 – Core performance modules**
6. Sales pipeline: products, quotations → orders → invoices → returns with lines; net sales = invoiced − returns − posted CNs; orders/quotations never counted as sales; product-level reports.
7. Collections: promises with kept/broken/partly-kept outcomes, defined ratios, attribution reporting.
8. Separate GRV / CN / deduction / **dispute** registers with claimed / approved / posted / recovered amounts and ageing.
9. Reconciliation control centre: company ledger vs customer statement vs my balance, a three-way difference, and sign-off.

**P3 – Personal and evidence modules**
10. Employment profile and timeline (events, salary structure history).
11. Earnings lifecycle (expected / earned / approved / paid / pending / disputed / unverified), and an EOSB estimate shown only when the data is sufficient, with disclosed assumptions.
12. Work expenses register (personal vs company, reimbursable, reimbursed vs pending, receipts).
13. Activities & achievements (verified vs self-claimed, with evidence links).
14. Document & evidence register: Blob attachments in IndexedDB (size limits, image/PDF preview), verification status, links to any record, a "user-collected, not an official document" disclaimer, and ZIP backup including blobs.

**P4 – Reporting and polish**
15. Executive dashboard across all modules with filters (period/customer/salesman/attribution) and drill-down from every figure.
16. Employment exit report for any period and as-of date: PDF + CSV + Excel, with definitions, assumptions, data-completeness warnings and an evidence index.
17. Global search over all tables and evidence, a correction log with a reason field, README update, screenshots, full unit and e2e suites on both browsers, offline test of attachments and the exit report.

Each phase ends green (tsc, vitest, Playwright Chromium + WebKit) and is committed separately.

## 7. Test run for this audit

Run on 23 Oct 2026, about 17:45 Asia/Dubai, against the current build and with no code changes:
* `npx vitest run` → **5 files, 44/44 passed**
* `npx playwright test` → **31 passed, 1 skipped** (the screenshot test on WebKit), 1.8 min

The screenshot test regenerated `screenshots/*.png` as a side effect; these were reverted to the committed versions.
