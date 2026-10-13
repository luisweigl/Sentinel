import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Service, UptimeWindow } from './App';
import { historyForWindow, historyPage, historyPageSize, summarizeHistory } from './service-history';
import type { CheckResult } from './service-history';

interface Props {
  service: Service;
  history: CheckResult[];
  onClose: () => void;
  onUpdate: (service: Service) => void;
  onDelete: () => void;
}

const formatTime = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});

export function ServiceDetail({ service, history, onClose, onUpdate, onDelete }: Props) {
  const [window, setWindow] = useState<UptimeWindow>('24h');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(() => historyForWindow(history, window), [history, window]);
  const summary = summarizeHistory(filtered);
  const pages = Math.max(1, Math.ceil(filtered.length / historyPageSize));
  const latest = history[0];

  function finishEditing() {
    setEditing(false);
    setFormError('');
    editButton.current?.focus();
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const url = String(data.get('url') ?? '').trim();
    const intervalSeconds = Number(data.get('interval'));
    const timeoutSeconds = Number(data.get('timeout'));
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
    } catch {
      setFormError('Enter an absolute HTTP or HTTPS URL.');
      return;
    }
    if (!name || !Number.isSafeInteger(intervalSeconds * 1000) || intervalSeconds <= 0 || !Number.isSafeInteger(timeoutSeconds * 1000) || timeoutSeconds <= 0) {
      setFormError('Enter a name and positive interval and timeout values.');
      return;
    }
    const enabled = data.get('enabled') === 'on';
    onUpdate({ ...service, name, url, intervalSeconds, timeoutSeconds, status: enabled ? resultStatus() : 'paused' });
    finishEditing();
  }

  function resultStatus(): Service['status'] {
    return !latest ? 'pending' : latest.result === 'Healthy' ? 'healthy' : 'failing';
  }

  return (
    <section id={`service-detail-${service.id}`} className="service-detail" aria-labelledby={`detail-title-${service.id}`}>
      <div className="detail-heading">
        <h2 id={`detail-title-${service.id}`}>{service.name}</h2>
        <button type="button" onClick={onClose}>Close details</button>
      </div>
      <dl className="detail-config">
        <div className="detail-url"><dt>URL</dt><dd>{service.url}</dd></div>
        <div><dt>Monitoring</dt><dd>{service.status === 'paused' ? 'Paused' : 'Enabled'}</dd></div>
        <div><dt>Interval</dt><dd>{service.intervalSeconds} seconds</dd></div>
        <div><dt>Timeout</dt><dd>{service.timeoutSeconds ?? 10} seconds</dd></div>
      </dl>
      <div className="detail-actions">
        <button type="button" onClick={() => onUpdate({ ...service, status: service.status === 'paused' ? resultStatus() : 'paused' })}>{service.status === 'paused' ? 'Resume monitoring' : 'Pause monitoring'}</button>
        <button type="button" ref={editButton} onClick={() => { setEditing(true); setConfirmDelete(false); }}>Edit service</button>
        <button type="button" onClick={() => { setConfirmDelete(true); setEditing(false); }}>Delete service</button>
      </div>
      {confirmDelete && <div className="delete-confirmation" role="group" aria-label="Confirm service deletion">
        <p>Delete {service.name} and all its check history? This cannot be undone.</p>
        <button type="button" className="delete-action" onClick={onDelete}>Delete service and history</button>
        <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
      </div>}
      {editing && <form className="detail-edit" onSubmit={save}>
        <h3>Edit service</h3>
        <label>Name<input name="name" defaultValue={service.name} required autoFocus /></label>
        <label>HTTP / HTTPS URL<input name="url" type="url" defaultValue={service.url} required /></label>
        <label>Check interval (seconds)<input name="interval" type="number" min="0.001" step="0.001" defaultValue={service.intervalSeconds} required /></label>
        <label>Timeout (seconds)<input name="timeout" type="number" min="0.001" step="0.001" defaultValue={service.timeoutSeconds ?? 10} required /></label>
        <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked={service.status !== 'paused'} />Monitoring enabled</label>
        {formError && <p className="failure-result" role="alert">{formError}</p>}
        <div className="detail-actions"><button type="button" onClick={finishEditing}>Cancel</button><button type="submit">Save service</button></div>
      </form>}
      <div className="latest-check">
        <p>Last check: <strong className={latest && latest.result !== 'Healthy' ? 'failure-result' : undefined}>{service.result}</strong> / {service.lastChecked}</p>
        {latest?.error && <p className="failure-result">Error: {latest.error}</p>}
      </div>
      <div className="detail-heading history-heading">
        <h3>History</h3>
        <label className="filter-field uptime-filter"><span>Window</span><select value={window} onChange={(event) => { setWindow(event.target.value as UptimeWindow); setPage(1); }}>
          <option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option>
        </select></label>
      </div>
      <p className="history-summary">Uptime: <strong>{summary.uptime === null ? '—' : `${summary.uptime.toFixed(2)}%`}</strong> / {summary.successful} successful / {summary.total} completed checks</p>
      <div className="history-scroll" role="region" aria-label="Check history, scroll horizontally on small screens" tabIndex={0}>
      <table className="history-table">
        <caption className="sr-only">Check history for {service.name}. Times include the local time zone.</caption>
        <thead><tr><th scope="col">Checked at</th><th scope="col">Result</th><th scope="col" className="numeric">HTTP status</th><th scope="col" className="numeric">Duration</th><th scope="col">Error</th></tr></thead>
        <tbody>
          {historyPage(filtered, page).map((check) => <tr key={check.checkedAt}>
            <td className="last-checked"><time dateTime={new Date(check.checkedAt).toISOString()}>{formatTime.format(check.checkedAt)}</time></td>
            <td className={check.result !== 'Healthy' ? 'failure-result' : undefined}>{check.result}</td>
            <td className="numeric metric">{check.httpStatus ?? '—'}</td>
            <td className="numeric metric">{check.durationMs === null ? '—' : `${check.durationMs} ms`}</td>
            <td className="history-error">{check.error ?? '—'}</td>
          </tr>)}
          {filtered.length === 0 && <tr><td colSpan={5} className="empty-state">No checks recorded yet.</td></tr>}
        </tbody>
      </table>
      </div>
      <nav className="history-pagination" aria-label={`History pagination for ${service.name}`}>
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span role="status">Page {page} of {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </nav>
    </section>
  );
}
