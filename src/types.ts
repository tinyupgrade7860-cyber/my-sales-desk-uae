// Core data model for My Sales Desk UAE. All money values are stored in AED with 2 decimals.
export type ID = string;

export interface Base {
  id: ID;
  createdAt: string; // ISO timestamp
  updatedAt: string;
  deleted?: boolean; // soft delete (voided) - excluded from all calculations
  deleteReason?: string;
}

export interface Customer extends Base {
  code: string;
  name: string;
  trn?: string; // UAE VAT Tax Registration Number (fictional)
  contactPerson?: string;
  phone?: string;
  email?: string;
  emirate?: string;
  paymentTermsDays: number;
  creditLimit?: number;
  salesman?: string;
  notes?: string;
  importBatchId?: ID; // created by a statement import
}

export interface Invoice extends Base {
  invoiceNo: string;
  customerId: ID;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string;
  paymentTermsDays: number;
  netAmount: number;
  vatRate: number; // percent, e.g. 5
  vatAmount: number;
  grossAmount: number;
  lpo?: string;
  salesman?: string;
  notes?: string;
  importBatchId?: ID; // created by a statement import
}

export type PaymentMethod = 'Cheque' | 'Bank Transfer' | 'Cash' | 'Card' | 'PDC' | 'Other';

export interface Collection extends Base {
  receiptRef: string;
  customerId: ID;
  date: string;
  amount: number;
  method: PaymentMethod;
  chequeNo?: string;
  bank?: string;
  notes?: string;
  importBatchId?: ID;
}

/** Explicit allocation of (part of) a collection to an invoice. */
export interface Allocation extends Base {
  collectionId: ID;
  invoiceId: ID;
  amount: number;
}

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface GRV extends Base {
  grvRef: string;
  customerId: ID;
  invoiceId?: ID;
  date: string;
  amount: number;
  reason: string;
  status: ApprovalStatus;
  notes?: string;
}

export interface CreditNote extends Base {
  cnRef: string;
  customerId: ID;
  invoiceId?: ID;
  grvId?: ID; // credit note issued against a GRV
  date: string;
  amount: number;
  reason: string;
  status: ApprovalStatus;
  applied: boolean; // adjustment has been applied to the account
  notes?: string;
}

export type DeductionStatus = 'Claimed' | 'Disputed' | 'Accepted' | 'Partially Accepted' | 'Rejected';

export interface Deduction extends Base {
  ref: string;
  customerId: ID;
  invoiceId?: ID;
  date: string;
  claimedAmount: number;
  acceptedAmount: number; // only counted if status Accepted / Partially Accepted
  reason: string;
  supportingRef?: string;
  disputeNotes?: string;
  status: DeductionStatus;
}

export type ReconStatus = 'Matched' | 'Discrepancy' | 'Investigating' | 'Resolved';

export interface StatementRecon extends Base {
  customerId: ID;
  statementDate: string;
  statementRef?: string;
  statementBalance: number; // balance per authorised customer statement
  recordedBalance: number; // snapshot of my recorded balance at the time of reconciling
  difference: number; // recorded - statement
  status: ReconStatus;
  notes?: string;
  importBatchId?: ID; // snapshot created by a statement-file import
}

export type FollowUpStatus = 'Open' | 'Promised' | 'Paid' | 'Escalated' | 'Closed';

export interface FollowUp extends Base {
  customerId: ID;
  invoiceId?: ID;
  contactDate: string;
  nextContactDate?: string;
  promisedDate?: string;
  promisedAmount?: number;
  status: FollowUpStatus;
  notes?: string;
}

export interface AuditEntry {
  id: ID;
  ts: string;
  entity: TableName;
  entityId: ID;
  action: 'create' | 'update' | 'delete' | 'restore' | 'import';
  summary: string;
  before?: any;
  after?: any;
}

export interface Settings {
  id: 'settings';
  currency: string;
  defaultVatRate: number;
  defaultTermsDays: number;
  upcomingDays: number;
  ownerName: string;
  companyName: string; // employer, used on statements and My Job
  jobStartDate: string; // YYYY-MM-DD
  salesBasis: 'net' | 'gross'; // which invoice value counts as "sales" for targets/plans
  notifications: boolean; // user opted in to Web Notifications (where supported)
}

// ---------- v2: statement import ----------
export interface ImportChange { table: TableName; id: ID; action: 'create' | 'update'; before?: any }
export interface ImportBatch extends Base {
  fileName: string;
  fileHash: string;
  fileType: 'xlsx' | 'xls' | 'csv' | 'pdf';
  statementDate: string;
  importedAt: string;
  rowCount: number;
  summary: string;
  changes: ImportChange[];
  status: 'Active' | 'Undone';
  undoneAt?: string;
  notes?: string;
}
/** One row of an imported customer statement, kept as a reconciliation snapshot. */
export interface StatementLine extends Base {
  batchId: ID;
  statementId?: ID; // StatementRecon created for the customer
  customerId: ID;
  invoiceId?: ID;
  invoiceNo: string;
  billingDate: string;
  salesman?: string;
  customerName: string;
  totalAmount: number;
  taxAmount: number;
  grandTotal: number;
  receivedAmount: number;
  balance: number; // per file
  ageingDays: number; // recomputed (statement date - billing date)
  remarks?: string;
  appBalance: number; // app remaining balance of the invoice at import time
  difference: number; // appBalance - balance
}

// ---------- v2: targets, sales values, plans, tasks ----------
export interface Target extends Base {
  month: string; // YYYY-MM
  customerId?: ID; // empty = overall target
  salesTarget: number;
  collectionTarget: number;
  notes?: string;
}
/** Manual sales value (e.g. sales not invoiced in this app, or corrections). Added to invoice-derived sales. */
export interface SalesEntry extends Base {
  date: string;
  customerId?: ID;
  salesman?: string;
  amount: number;
  description: string;
}
export interface Plan extends Base {
  month: string; // YYYY-MM
  customerId: ID;
  plannedSales: number;
  plannedCollection: number;
  visitDates: string[];
  visitsDone: string[];
  notes?: string;
}
export type TaskStatus = 'Open' | 'In progress' | 'Waiting' | 'Done' | 'Cancelled';
export interface TaskUpdate { ts: string; text: string; status?: TaskStatus }
export interface Task extends Base {
  title: string;
  customerId?: ID;
  invoiceId?: ID;
  dueDate: string;
  priority: 'Low' | 'Normal' | 'High';
  status: TaskStatus;
  updates: TaskUpdate[];
  notes?: string;
}

// ---------- v2: My Job (personal employment records) ----------
export type JobCategory =
  | 'Salary' | 'Incentive' | 'Bonus' | 'Vehicle allowance' | 'Other allowance' | 'Kitha (customer commission)'
  | 'Expense claim' | 'Other expense' | 'Other income' | 'Other outflow' | 'Salary deduction'
  | 'Advance / loan received' | 'Loan repayment' | 'Fuel / mileage' | 'Phone bill'
  | 'Leave' | 'Document expiry' | 'Note / achievement' | 'Target history';
export type ClaimStatus = 'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Rejected';
export interface JobRecord extends Base {
  category: JobCategory;
  date: string;
  month?: string; // pay month YYYY-MM (salary etc.)
  direction: 'in' | 'out' | 'none';
  amount: number;
  description: string;
  customerId?: ID; // kitha: optional link to a customer
  claimStatus?: ClaimStatus;
  reimbursedAmount?: number;
  reimbursedDate?: string;
  km?: number;
  endDate?: string; // leave to-date
  leaveType?: string;
  expiryDate?: string; // documents
  docNumber?: string;
  targetValue?: number;
  achievedValue?: number;
  ref?: string;
  notes?: string;
}

export type TableName =
  | 'customers' | 'invoices' | 'collections' | 'allocations' | 'grvs'
  | 'creditNotes' | 'deductions' | 'statements' | 'followUps'
  | 'importBatches' | 'statementLines' | 'targets' | 'salesEntries' | 'plans' | 'tasks' | 'jobRecords';

export interface DataSet {
  customers: Customer[];
  invoices: Invoice[];
  collections: Collection[];
  allocations: Allocation[];
  grvs: GRV[];
  creditNotes: CreditNote[];
  deductions: Deduction[];
  statements: StatementRecon[];
  followUps: FollowUp[];
  importBatches: ImportBatch[];
  statementLines: StatementLine[];
  targets: Target[];
  salesEntries: SalesEntry[];
  plans: Plan[];
  tasks: Task[];
  jobRecords: JobRecord[];
}

export const TABLES: TableName[] = [
  'customers', 'invoices', 'collections', 'allocations', 'grvs',
  'creditNotes', 'deductions', 'statements', 'followUps',
  'importBatches', 'statementLines', 'targets', 'salesEntries', 'plans', 'tasks', 'jobRecords'
];
/** Tables that exist since schema v1 (backups of v1 do not contain the others). */
export const V1_TABLES: TableName[] = TABLES.slice(0, 9);
export const emptyDataSet = (): DataSet => Object.fromEntries(TABLES.map(t => [t, []])) as any;
