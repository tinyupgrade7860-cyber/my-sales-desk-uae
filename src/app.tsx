import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute, go } from './router';
import { useStore } from './store';
import { ToastHost, SheetHost } from './ui';
import { Dashboard } from './screens/dashboard';
import { CustomersList, CustomerProfile, CustomerForm } from './screens/customers';
import { InvoicesList, InvoiceDetail, InvoiceForm } from './screens/invoices';
import { CollectionsList, CollectionDetail, CollectionForm } from './screens/collections';
import { AdjList, AdjForm } from './screens/adjustments';
import { ReconList, ReconForm } from './screens/recon';
import { FollowUps, FollowUpForm } from './screens/followups';
import { Reports } from './screens/reports';
import { SearchScreen } from './screens/search';
import { DataScreen } from './screens/data';
import { SettingsScreen, HistoryScreen, MoreScreen } from './screens/misc';
import { ImportScreen, ImportsList, ImportDetail, StatementLineForm } from './screens/imports';
import { PerformanceScreen, TargetsList, TargetForm, SalesEntries, SalesForm } from './screens/perf';
import { PlanScreen, PlanForm, TasksScreen, TaskForm, AlertCenter, useAlerts } from './screens/plans';
import { JobScreen, JobForm } from './screens/job';
import { StatementsScreen } from './screens/statements';
import { notifyAlerts } from './lib/alerts';

function useOnline() {
  const [on, set] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => set(true), b = () => set(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

const TABS = [
  ['/', 'Home', '◉'], ['/customers', 'Customers', '☺'], ['/invoices', 'Invoices', '▤'], ['/collections', 'Collect', '⇩'], ['/more', 'More', '☰']
] as const;

export function App() {
  const r = useRoute();
  const s = useStore();
  const online = useOnline();
  const { alerts, badge } = useAlerts();
  // best-effort notification while the app is open (no server push - see README)
  useEffect(() => {
    if (!s.ready || !s.settings.notifications) return;
    const f = () => { if (document.visibilityState === 'visible') notifyAlerts(alerts, s.today); };
    f(); document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [s.ready, s.version]);
  const [p0, p1] = r.path;
  let view;
  if (!s.ready) view = <div class="splash">Loading your desk…</div>;
  else switch (p0) {
    case undefined: view = <Dashboard />; break;
    case 'customers': view = p1 ? <CustomerProfile id={p1} /> : <CustomersList />; break;
    case 'customer-form': view = <CustomerForm id={p1} />; break;
    case 'invoices': view = p1 ? <InvoiceDetail id={p1} /> : <InvoicesList />; break;
    case 'invoice-form': view = <InvoiceForm id={p1} />; break;
    case 'collections': view = p1 ? <CollectionDetail id={p1} /> : <CollectionsList />; break;
    case 'collection-form': view = <CollectionForm id={p1} />; break;
    case 'grvs': view = <AdjList kind="grvs" />; break;
    case 'credit-notes': view = <AdjList kind="creditNotes" />; break;
    case 'deductions': view = <AdjList kind="deductions" />; break;
    case 'grv-form': view = <AdjForm kind="grvs" id={p1} />; break;
    case 'cn-form': view = <AdjForm kind="creditNotes" id={p1} />; break;
    case 'deduction-form': view = <AdjForm kind="deductions" id={p1} />; break;
    case 'recon': view = <ReconList />; break;
    case 'recon-form': view = <ReconForm id={p1} />; break;
    case 'followups': view = <FollowUps />; break;
    case 'followup-form': view = <FollowUpForm id={p1} />; break;
    case 'reports': view = <Reports />; break;
    case 'search': view = <SearchScreen />; break;
    case 'data': view = <DataScreen />; break;
    case 'settings': view = <SettingsScreen />; break;
    case 'history': view = <HistoryScreen />; break;
    case 'more': view = <MoreScreen />; break;
    case 'import': view = <ImportScreen />; break;
    case 'imports': view = p1 ? <ImportDetail id={p1} /> : <ImportsList />; break;
    case 'statement-line': view = <StatementLineForm id={p1} />; break;
    case 'performance': view = <PerformanceScreen />; break;
    case 'targets': view = <TargetsList />; break;
    case 'target-form': view = <TargetForm id={p1} />; break;
    case 'sales-entries': view = <SalesEntries />; break;
    case 'sales-form': view = <SalesForm id={p1} />; break;
    case 'plans': view = <PlanScreen />; break;
    case 'plan-form': view = <PlanForm id={p1} />; break;
    case 'tasks': view = <TasksScreen />; break;
    case 'task-form': view = <TaskForm id={p1} />; break;
    case 'alerts': view = <AlertCenter />; break;
    case 'job': view = <JobScreen />; break;
    case 'job-form': view = <JobForm id={p1} />; break;
    case 'statements': view = <StatementsScreen />; break;
    default: view = <div class="content"><p>Page not found.</p><button class="btn" onClick={() => go('/')}>Home</button></div>;
  }
  const active = (t: string) => t === '/' ? !p0 : ('/' + (p0 || '')).startsWith(t) || (t === '/more' && !['customers', 'invoices', 'collections', undefined, 'customer-form', 'invoice-form', 'collection-form'].includes(p0));
  return (
    <div class="app">
      <div class={'netbar ' + (online ? 'on' : 'off')} data-testid="net-status" role="status" aria-live="polite">
        {online ? 'Online' : 'Offline – changes are saved on this device'}
      </div>
      <Fragment key={r.raw}>{view}</Fragment>
      <nav class="tabbar">
        {TABS.map(([path, label, ic]) => (
          <a href={'#' + path} class={'tab' + (active(path) ? ' on' : '')} data-testid={'tab-' + label.toLowerCase()}><span class="tab-ic">{ic}</span><span>{label}</span>{path === '/more' && badge > 0 && <span class="nbadge" data-testid="more-badge">{badge}</span>}</a>
        ))}
      </nav>
      <ToastHost />
      <SheetHost />
    </div>
  );
}
