# My Sales Desk UAE

This is a mobile-first Progressive Web App (PWA) for a UAE field sales executive. It tracks customers, invoices, collections, GRVs, credit notes, deductions, statement reconciliations and follow-ups, and it produces reports. It was built for an iPhone (16 Pro, 402×874 CSS px) but runs in any modern browser.

**v2 adds:** bulk statement upload (PDF / Excel / CSV) with a validation preview, idempotent re-import and per-batch undo; monthly sales and collection targets with a performance dashboard; monthly customer plans (planned sales, collections and visits) against actuals; tasks with update history; an in-app alert centre with badges, best-effort notifications and a calendar (.ics) export; formatted customer statements (Excel and PDF, one customer or in bulk); and a private **My Job** ledger (salary, allowances, kitha, claims, loans, leave, documents and more). See §10–§15.

* **No backend, no account, no paid service.** All data stays on the device, in the browser's IndexedDB.
* **Works offline** after the first load. A service worker pre-caches the whole app shell, including the lazy-loaded PDF, Excel (SheetJS, ExcelJS), pdf.js (+ worker) and zip libraries and the sample statement files (32 files, about 4.6 MB). Importing and exporting statements therefore works with no network; this is covered by an e2e test.
* **AED by default**, with configurable VAT (default 5%) and default payment terms (60 days) under *More › Settings*.
* All bundled data is fictional. The demo customers are marked "(Demo)" and all TRNs and phone numbers are made up.

---

## 1. Run / build

Requirements: Node.js 18+ (tested with Node 22) and npm.

```bash
npm install
npm run dev            # Vite dev server with hot reload (no service worker in dev)
npm run build          # type-check (tsc) + production build into dist/ (generates sw.js)
npm run serve          # serve dist/ at http://0.0.0.0:4173 (SPA fallback); this is the real PWA
npm test               # vitest unit tests (calculation engine, backup validation, IndexedDB layer)
npx playwright install --with-deps chromium webkit   # first time only
npm run test:e2e       # Playwright e2e: Chromium (402×874 mobile) + WebKit (iPhone 15 Pro profile)
npm run icons          # regenerate PNG icons from public/icons/icon.svg
npm run samples        # regenerate the fictional sample statements in samples/ and public/samples/
```

The service worker only registers on `https://` or `http://localhost`. To test offline mode, run `npm run build && npm run serve`, open `http://localhost:4173` once, then turn the network off.

## 2. Install on iPhone (Add to Home Screen)

iOS only lets a PWA install from an **HTTPS** URL. A `localhost` URL on another computer won't work. First host `dist/` somewhere with HTTPS (see §8), then:

1. Open the HTTPS URL in **Safari**. Other iOS browsers can't install PWAs on older iOS versions; Safari always can.
2. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then **Add**.
3. Launch it from the home-screen icon. It opens full screen (standalone), and the status bar and home-indicator areas are padded through `env(safe-area-inset-*)`.
4. Open the app once while online so the service worker can cache everything. After that it also works in Airplane Mode.
5. Open **More › Data & backup** and check "Persistent storage". The app calls `navigator.storage.persist()`. Safari decides whether to grant it, and installed home-screen apps are much less likely to be evicted.

> **Important:** the data lives only in this app's storage on this iPhone. Deleting the home-screen app, or clearing Safari website data, deletes it. Export a JSON backup regularly (*More › Data & backup › Export JSON backup*) and keep it in Files/iCloud Drive. The app shows a reminder when the last backup is more than 7 days old. Data in Safari and in the home-screen app are **separate** stores on iOS.

## 3. Architecture

| Layer | Tech | Files |
|---|---|---|
| UI | Preact 10 + TypeScript, hash router, no CSS framework (hand-written mobile CSS with dark mode and print styles) | `src/app.tsx`, `src/screens/*`, `src/ui.tsx`, `src/styles.css` |
| State | A tiny global store: the whole dataset in memory, reloaded from IndexedDB after every write (`refresh()`). Every figure is **derived**, never stored | `src/store.ts` |
| Calculations | Pure functions with no I/O, unit tested. This is the single source of truth for balances, statuses, ageing, reports, reconciliation, duplicate detection and validation | `src/calc.ts`, `src/ledger.ts` |
| Persistence | IndexedDB via Dexie 4. Multi-table writes run inside one transaction (e.g. a payment plus its allocations plus the audit entry) | `src/db.ts` |
| Backup | Versioned JSON with an FNV-1a checksum, validated before restore. CSV with BOM and spreadsheet-formula-injection protection | `src/backup.ts` |
| Export | CSV/JSON/PDF (jsPDF + autotable, lazy-loaded). On iOS the file goes through the Share Sheet (`navigator.share` with files); other platforms use a normal download | `src/exporter.ts` |
| Offline | `vite-plugin-pwa` (Workbox generateSW) pre-caches all built assets. Navigation falls back to `index.html`. An online/offline indicator bar sits at the top | `vite.config.ts`, `src/main.tsx` |
| PWA / iOS | Web manifest (standalone, theme colour, 192/512/maskable icons), `apple-mobile-web-app-*` meta tags, apple-touch-icon, `viewport-fit=cover` plus safe-area insets | `index.html`, `public/icons/*` |

Screens: Dashboard · Customers (list / profile / form) · Invoices · Collections (with an allocation editor) · GRVs · Credit notes · Deductions · Statement reconciliation · Follow-ups · Reports · Global search & filters · Data & backup · Settings · Change history.

## 4. Data model (IndexedDB database `my-sales-desk-uae`, schema v2)

Every record has a unique `id` (UUID), `createdAt`, `updatedAt`, and an optional `deleted` plus `deleteReason`. Deletion is always a soft **void**: the record is kept, hidden from calculations, and can be restored.

| Table | Key fields |
|---|---|
| `customers` | code, name, trn (15 digits, validated), contactPerson, phone, email, emirate, paymentTermsDays, creditLimit |
| `invoices` | invoiceNo (unique, duplicate blocked), customerId, invoiceDate, dueDate, paymentTermsDays, netAmount, vatRate, vatAmount, grossAmount, lpo |
| `collections` | receiptRef, customerId, date, amount, method (Cheque/Bank Transfer/Cash/Card/PDC/Other), chequeNo, bank |
| `allocations` | **explicit allocation table**: collectionId, invoiceId, amount. One collection can be split across many invoices, and one invoice can be paid by many collections |
| `grvs` | grvRef, customerId, invoiceId?, date, amount, reason, status (Pending/Approved/Rejected) |
| `creditNotes` | cnRef, customerId, invoiceId?, grvId?, date, amount, reason, status (Pending/Approved/Rejected), **applied** (boolean) |
| `deductions` | ref, customerId, invoiceId?, date, claimedAmount, acceptedAmount, reason, supportingRef, disputeNotes, status (Claimed/Disputed/Accepted/Partially Accepted/Rejected) |
| `statements` | customerId, statementDate, statementRef, statementBalance, recordedBalance (snapshot), difference, status (Matched/Discrepancy/Investigating/Resolved) |
| `followUps` | customerId, invoiceId?, contactDate, nextContactDate, promisedDate, promisedAmount, status |
| `auditLog` | ts, entity, entityId, action (create/update/delete/restore/import), summary, before, after. This is the correction history, shown on every record and under *More › Change history* |
| `settings` | currency (AED), defaultVatRate, defaultTermsDays, upcomingDays, ownerName; v2: companyName (default "Bisbelluk Trading LLC"), jobStartDate (default 2024-12-01), salesBasis (net/gross), notifications |
| `importBatches` (v2) | fileName, fileHash (SHA-256), fileType, statementDate, options, counts, summary, notes, status (Active/Undone), **changes** (every record created/updated, with its before-image, used for undo) |
| `statementLines` (v2) | batchId, customerId, invoiceId, invoiceNo, billingDate, salesman, total, tax, grand, received, balance, ageing, remarks, appBalance, difference – the statement snapshot, editable |
| `targets` (v2) | month (YYYY-MM), customerId? (empty = overall), salesTarget, collectionTarget |
| `salesEntries` (v2) | date, customerId?, salesman?, amount, description – manual sales not covered by invoices |
| `plans` (v2) | month, customerId, plannedSales, plannedCollection, visitDates[], visitsDone[], notes |
| `tasks` (v2) | title, customerId?, invoiceId?, dueDate, priority, status (Open/In progress/Waiting/Done/Cancelled), updates[] (timestamped status/notes log) |
| `jobRecords` (v2) | category, date, amount, direction (in/out/none), description, month, customerId, claimStatus, reimbursedAmount/Date, km, leave from/to/type, document type/no/expiry, target/achieved |

Customers and invoices also gained an optional `salesman` field.

**Migration:** the Dexie schema is versioned (`db.version(1)` → `db.version(2)`, i.e. IndexedDB version 10 → 20). Upgrading only *adds* tables and indexes and fills in missing settings defaults; nothing is rewritten or dropped, and the upgrade writes a "Database upgraded to schema v2" audit entry. This is tested both in unit tests (a real v1 Dexie database upgraded under fake-indexeddb) and in an e2e test that builds a raw v1 IndexedDB in the browser and then opens the app.

## 5. Calculation rules

All amounts are rounded to 2 dp. Sums are added in fils (integer cents) so floating-point drift can't creep in.

* **Invoice gross** = net + VAT (net × VAT%). You can enter net (VAT is calculated) or gross (net is back-calculated).
* **Invoice remaining** = gross
  − allocations from **non-voided** collections
  − credit notes that are **Approved _and_ Applied**
  − deductions that are **Accepted** (acceptedAmount, or claimedAmount if no accepted amount was entered) or **Partially Accepted** (acceptedAmount).
* **Things that never reduce a balance:** Pending/Rejected credit notes, Approved-but-not-applied credit notes, and Claimed/**Disputed**/Rejected deductions. They show up as "pending items (no effect)".
* **GRVs never reduce a balance by themselves.** Only the credit note issued against the GRV does (`creditNote.grvId`). Only one non-rejected credit note is allowed per GRV. Together these stop a goods return from being counted twice.
* **Invoice status:** Paid (remaining ≤ 0.005), Partially Paid (some payments or adjustments), Unpaid, or Over-credited (remaining < 0). **Overdue** means remaining > 0 and the due date has passed. Overdue is shown as an extra badge next to the payment status.
* **Due date** = invoice date + payment terms (can be overridden).
* **Collections:** allocations can't exceed the payment amount, and an allocation can't exceed the invoice's remaining balance (excluding this payment's own existing allocation). Any unallocated part is kept as **on-account** money. Voiding a collection (e.g. a bounced cheque) voids its allocations and re-opens the invoices.
* **Customer balance** = Σ invoice gross − Σ collections received − Σ effective adjustments. Unallocated receipts therefore reduce the customer balance, and nothing is counted twice.
* **Collection %** = collections ÷ (invoiced − effective adjustments) × 100.
* **Ageing** buckets by days past due on the remaining balance: Not due, 1-30, 31-60, 61-90, 91-120, 120+.
* **Statement reconciliation:** difference = my recorded balance as at the statement date − the customer's statement balance. The app gives hints for likely causes: pending or unapplied credit notes, disputed or claimed deductions, approved GRVs without a CN, pending GRVs, invoices or payments in the 7 days before the statement date, and any single deduction, CN or invoice whose amount exactly matches the difference (flagged "matches the difference").
* **Duplicate warnings** (case-insensitive, ignoring voided records): an invoice number is blocked. Receipt references, GRV/CN/deduction references, and customer names or codes raise a warning (for a customer name, a "Save anyway" confirmation).

## 6. Reports & export

* **Dashboard:** invoiced, collections, outstanding, overdue (amount and count), collection %, unallocated receipts, GRV totals (pending), credit notes (applied/pending), deduction claims (disputed/accepted), a 12-month trend chart, ageing, upcoming dues (default 7 days) and follow-up alerts. It has *All time / This month / This year / Last 12 m* filters.
* **Reports:** weekly, monthly, quarterly and yearly periods (with a date range and customer filter), customer-wise, ageing, a 2-year month-by-month summary with year-over-year growth, and a monthly report. Each one exports to **CSV** and **PDF**.
* **Customer profile:** statement PDF and full-history CSV (the ledger with a running balance).
* **Data & backup:** full JSON backup, all tables as CSV, ledger CSV, validated **restore** (with a preview of counts, errors and warnings, and a confirmation step), sample data, and a full wipe (you have to type DELETE).

### Backup format

```json
{ "app": "my-sales-desk-uae", "schemaVersion": 2, "exportedAt": "…", "counts": {…},
  "checksum": "fnv1a-…", "data": { "customers": [], "invoices": [], "collections": [], "allocations": [],
  "grvs": [], "creditNotes": [], "deductions": [], "statements": [], "followUps": [], "auditLog": [], "importBatches": [], "statementLines": [],
  "targets": [], "salesEntries": [], "plans": [], "tasks": [], "jobRecords": [], "settings": {…} } }
```

Version 1 backups (from the first release) still restore; the new tables are simply empty. Restore checks the app id, the schema version, required fields, numeric amounts, ISO dates, referential integrity (allocation → collection/invoice, invoice → customer…), duplicate ids, and the checksum. Restore runs in a single transaction, so a failure leaves the existing data untouched.

## 7. Tests

* `tests/unit/calc.test.ts` covers balances, partial and multi-invoice allocation, the GRV/CN/deduction rules, ageing, reports, the 2-year summary, reconciliation, duplicates and validation.
* `tests/unit/backup.test.ts` covers checksum, validation and rejection of tampered or junk backups, plus CSV escaping.
* `tests/unit/db.test.ts` runs Dexie against fake-indexeddb: an atomic multi-invoice collection, re-allocation, voiding, and a full export → clear → restore round trip.
* `tests/e2e/workflows.spec.ts` runs the full UI workflow: customer → invoices → partial payment → one payment allocated across several invoices → GRV → applied approved CN → disputed deduction (balance unchanged) → accepted deduction → reconciliation discrepancy with hint → reload persistence. A second test covers voiding a bounced cheque.
* `tests/e2e/backup.spec.ts` covers JSON export → wipe → restore (data identical), rejection of tampered backups, CSV/PDF exports, and search and filters.
* `tests/e2e/offline.spec.ts` checks that the service worker is installed and controlling the page, that assets are cached, and that with `context.setOffline(true)` the app reloads, accepts a customer and an invoice, exports a PDF and keeps the data after a reload.
* `tests/unit/import.test.ts` covers header detection/aliases, number and date parsing, row validation, parsing the sample xlsx/xls/csv/PDF files, import → idempotent re-import (also of the PDF version of the same statement) → undo, update detection and the undo guard.
* `tests/unit/v2.test.ts` covers targets/performance maths (achievement, projection, MoM/YoY, contribution), plan vs actual, alerts and the .ics output, the job ledger, the statement builder (opening balance, running balance, allocation text, ageing), reading the generated statement xlsx back with SheetJS, checking the generated PDF with `pdftotext`, the zip, the v1 → v2 migration and backups containing the new tables.
* `tests/e2e/v2.spec.ts` (both browsers): statement import validation preview, Excel import with a per-row skip, idempotent re-import, undo; PDF import + undo; invoice and payment edits with history and recalculated balances, the payment shown with its allocation on the statement, and the single-customer xlsx/PDF downloads read back (SheetJS / pdftotext); bulk xlsx (sheet per customer + summary), bulk multi-page PDF and ZIP; targets/achievement, manual sales, plan vs actual, visits, alert centre + badge, .ics export, task history; My Job records, claim reimbursement, ledger totals, edit history, CSV/xlsx/PDF exports; v1 → v2 migration; backup/restore of the new tables; and offline import (xlsx + PDF) plus offline statement export.
* `tests/e2e/screenshots.spec.ts` regenerates `screenshots/*.png` at 402×874.

The e2e suite runs on **Chromium** (mobile 402×874, touch) and **WebKit** (Playwright's iPhone 15 Pro profile). WebKit on Linux is close to Safari, but it **is not real iOS Safari**. Check on a real iPhone before relying on the app.

## 8. Hosting options (to install on the iPhone you need HTTPS)

`dist/` is a static folder (about 4.6 MB), so any static host works. Only the app files are hosted; **your data never leaves the phone**.

* **Free, account needed:** GitHub Pages, Cloudflare Pages, or Netlify (drag-and-drop `dist/`). These give a permanent HTTPS URL.
* **No account, temporary:** a Cloudflare *quick tunnel*, e.g. `npm run serve` and then `cloudflared tunnel --url http://localhost:4173`. This gives a random `https://….trycloudflare.com` URL that only works while that computer and the tunnel keep running. The URL changes on every restart, and on iOS each new URL (origin) gets its **own separate storage**. That makes it fine for a trial, but not for daily use.

## 9. Project layout

```
src/            app code (see §3)
public/icons/   PWA + apple-touch icons (generated by scripts/make-icons.mjs)
tests/unit/     vitest
tests/e2e/      Playwright
screenshots/    402×874 screenshots of key screens (fictional demo data)
```

## 10. Bulk statement upload (More › Import statement file)

* **Formats:** `.xlsx`, `.xls`, `.csv` (parsed with SheetJS) and **text-based PDF** (parsed with pdf.js). Everything runs in the browser, offline; the file never leaves the device. Scanned/image-only PDFs have no text layer and are rejected with a message (no OCR).
* **Columns:** Invoice No, Billing Date, Sales Man, Customer, Total, Tax, Grand Total, Received, Balance, Ageing Days, Remarks. Headers are matched flexibly (case, spacing, punctuation and common aliases such as "Inv No", "Invoice Number", "Date", "Salesman", "Net", "VAT", "Amount", "Paid", "Outstanding", "Days"), the header row can be below a title block, and extra columns are ignored.
* **Preview and validation** before anything is written: missing/invalid dates and amounts, Total + Tax ≠ Grand Total, Grand − Received ≠ Balance, duplicate invoice numbers in the file, missing customer, ageing that disagrees with the statement date (ageing is recalculated to the statement date you choose). Each row shows what will happen – create, update (with a field-by-field diff), no change, or skip – and you can change the action per row. Options: auto-create unknown customers, and sync "Received" as on-account receipts so app balances match the statement.
* **Statement snapshot / reconciliation:** each import stores the statement lines and creates a reconciliation record per customer (statement balance vs. app balance, difference, Matched/Discrepancy).
* **Idempotent:** files are identified by SHA-256 and invoices by number, so re-importing the same file (or the PDF version of the same statement) results in "No changes"; a warning shows when the same file was imported before.
* **Logged and undoable:** every batch is listed under *More › Import history* with its summary, notes and every change. **Undo** restores the exact before-image of every record it changed and voids what it created; it refuses if you have since recorded payments against imported invoices (void those first).
* **Sample files (all fictional):** `samples/sample-statement-2026-10.xlsx`, `.pdf` (same 12 rows, 3 customers, statement date 22 Oct 2026), `sample-statement-variants.xls` (different headers) and `sample-statement-with-errors.csv` (deliberate errors). They are also linked from the upload screen. Regenerate with `npm run samples`.
* **SheetJS source:** `xlsx` 0.20.3 is installed from the official SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), because the npm-registry `xlsx` package is outdated (0.18.5, with known advisories). No account or key is needed.

## 11. Targets, performance and planning

* **Targets** (*More › Monthly targets*): monthly sales and collection targets, overall and/or per customer. If no overall target exists for a month, the sum of the customer targets is used.
* **Actual sales** = invoices in the month (net or gross – *Settings › Sales basis*) + manual sales entries (*More › Manual sales entries*). Collections = receipts dated in the month.
* **Performance dashboard** (*More › Targets & performance*, and a card on Home): achievement %, gap, run-rate projection to month end, required per remaining day, MoM and YoY growth, year-to-date vs same period last year, best/worst month, cumulative actual vs target chart, month table, customer contribution %. Filters: month, year, customer, salesman (with a salesman filter only actuals are shown – targets are per month/customer).
* **Monthly plan** (*More › Monthly plan*): per customer planned sales, collection and visit dates against actuals; tap a visit chip to mark it done. Customers with business but no plan are listed as "unplanned".
* **Tasks** (*More › Tasks*): title, customer/invoice link, due date, priority, status, and an update log (each status change/note is timestamped).

## 12. Alerts, notifications and calendar – what really works

* **Alert centre** (*More › Alerts*, bell on Home, badge on the More tab) is computed on the device every time data changes: invoices due today, overdue invoices (summary), payment promises, follow-ups, planned visits, tasks, expense claims waiting more than 30 days, and documents expiring within 60 days. Works fully offline.
* **System notifications are best effort only.** When you enable them in Settings, the app uses the Web Notification API to show a notification for today's items **while the app is open (or brought to the foreground)**, at most once per item per day. There is no server, so there is **no background push**: nothing arrives when the app is closed. On iPhone, web notifications are only available to apps added to the Home Screen (iOS 16.4+) and need your permission. Notification delivery on a real iPhone was **not** tested.
* **Calendar export (.ics)** is the reliable way to get reminders when the app is closed: *Alerts › Export to calendar* produces an iCalendar file (follow-ups, promises, visits, tasks, document expiry with a 30-day warning; each event has a 9 am alarm). Open it with the iPhone Calendar app. Re-export after changes; events are not synced automatically.

## 13. Editing and correction history

Every record type (customers, invoices, payments/allocations, GRVs, CNs, deductions, statements and statement lines, targets, manual sales, plans, tasks, job records, import batch notes) can be edited. Edits are validated with the same rules as on creation, balances/achievements are recomputed immediately (figures are always derived), and the audit log keeps a field-level before → after entry, shown on the record and under *More › Change history*.

## 14. Customer statements (More › Customer statements)

* Choose a customer and a period (*From* = opening balance date, *To* = statement date). The statement uses data **as at the statement date**: opening balance, every invoice and payment in the period with a running balance, the invoices each payment was allocated to (and any on-account remainder), totals, open invoices at the statement date with the receipts applied to each, ageing buckets, and the closing balance. Payments therefore appear on the statement as soon as they are recorded.
* **Excel** (ExcelJS): formatted sheet with the company header block (*Settings › Company name*, default "Bisbelluk Trading LLC"), number formats, frozen header row, totals, open invoices and ageing. **PDF** (jsPDF + autotable) with page numbers.
* **Bulk:** filter by emirate, salesman or "balance only", tick customers, then export either as **one file** (Excel: a Summary sheet plus one sheet per customer; PDF: one multi-page document) or as a **ZIP** with one file per customer. All generated on the device, offline.

## 15. My Job (More › My Job)

A private ledger of your own employment, separate from the sales data. Company name and job start date (default 1 Dec 2024) are editable in Settings; the demo data covers Dec 2024 onward and all amounts are fictional.

* **Record types:** salary, incentive, bonus, vehicle/other allowances, other income, salary deductions, kitha (commission paid to customers), other expenses, fuel/mileage (with km), phone bill, expense claims (Draft/Submitted/Approved/Paid/Rejected with reimbursement amount and date), advances/loans and repayments, leave (from/to/type), document expiry (visa, Emirates ID…), notes/achievements and target history.
* **Views:** ledger with running balance (a paid claim adds a "Claim reimbursed" inflow on the reimbursement date), monthly and yearly summaries with a chart, records, claims, documents & leave. Filters: year, month, category, search.
* **Exports:** CSV, Excel (Monthly / Ledger / Records sheets) and PDF. Included in the JSON backup.
