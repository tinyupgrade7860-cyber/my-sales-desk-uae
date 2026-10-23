import { render } from 'preact';
import { App } from './app';
import { refresh } from './store';
import { requestPersistence } from './db';
import './styles.css';

render(<App />, document.getElementById('app')!);
refresh().catch(e => {
  document.getElementById('app')!.innerHTML = `<div style="padding:24px;font-family:system-ui"><h2>Database error</h2><p>${String(e?.message || e)}</p><p>If you are in Private Browsing, local storage may be blocked.</p></div>`;
});
requestPersistence().then(p => { (window as any).__storage = p; });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => { (window as any).__sw = reg; }).catch(e => console.warn('SW registration failed', e));
  });
}
