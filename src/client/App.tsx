import { Fragment, useState } from 'react';
import { ServiceDetail } from './ServiceDetail';
import { createHistory, historyForWindow, summarizeHistory } from './service-history';

type ServiceStatus = 'healthy' | 'failing' | 'pending' | 'paused';
export type UptimeWindow = '24h' | '7d' | '30d';

export interface Service {
  id: number;
  name: string;
  url: string;
  status: ServiceStatus;
  result: string;
  durationMs: number | null;
  lastChecked: string;
  intervalSeconds: number;
  timeoutSeconds?: number;
}

const services: Service[] = [
  { id: 1, name: 'Authentication', url: 'https://auth.example.com/health', status: 'failing', result: 'Timeout', durationMs: null, lastChecked: '9 seconds ago', intervalSeconds: 60 },
  { id: 2, name: 'Billing', url: 'https://billing.example.com/health', status: 'pending', result: 'Awaiting check', durationMs: null, lastChecked: 'Never', intervalSeconds: 60 },
  { id: 3, name: 'API', url: 'https://api.example.com/health', status: 'healthy', result: '200 OK', durationMs: 142, lastChecked: '12 seconds ago', intervalSeconds: 30 },
  { id: 4, name: 'Website', url: 'https://example.com', status: 'healthy', result: '200 OK', durationMs: 86, lastChecked: '28 seconds ago', intervalSeconds: 60 },
  { id: 5, name: 'Documentation', url: 'https://docs.example.com', status: 'healthy', result: '200 OK', durationMs: 110, lastChecked: '41 seconds ago', intervalSeconds: 60 },
  { id: 6, name: 'Staging', url: 'https://staging.example.com/health', status: 'paused', result: '503 Unavailable', durationMs: 220, lastChecked: '3 hours ago', intervalSeconds: 120 },
];

const statusLabels: Record<ServiceStatus, string> = {
  healthy: 'Healthy', failing: 'Failing', pending: 'Awaiting check', paused: 'Paused',
};
const uptimeWindows: Record<UptimeWindow, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
const serviceHistories = new Map(services.map((service) => [service.id, createHistory(service)]));

export function App() {
  const [serviceList, setServiceList] = useState(services);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServiceStatus | 'all'>('all');
  const [uptimeWindow, setUptimeWindow] = useState<UptimeWindow>('24h');
  const query = search.trim().toLowerCase();
  const filteredServices = serviceList.filter((service) =>
    (status === 'all' || service.status === status)
    && `${service.name} ${service.url}`.toLowerCase().includes(query),
  );
  const filtersActive = search !== '' || status !== 'all';

  function clearFilters() {
    setSearch('');
    setStatus('all');
  }

  function closeDetails(id: number) {
    setExpandedId(null);
    document.getElementById(`service-toggle-${id}`)?.focus();
  }

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <span className="brand">sentinel<span className="brand-mark" aria-hidden="true">_</span></span>
          <span className="header-context">Service monitoring</span>
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <h1>Services</h1>
            <p>HTTP availability and recent check results.</p>
          </div>
        </div>

        <div className="summary" aria-label="Service summary">
          <span className="summary-total"><strong>{serviceList.length}</strong> services</span>
          <div className="summary-breakdown">
            {(Object.keys(statusLabels) as ServiceStatus[]).map((serviceStatus, index) => {
              const count = serviceList.filter((service) => service.status === serviceStatus).length;
              return (
                <span key={serviceStatus}>
                  {index > 0 && <span className="summary-separator" aria-hidden="true">/</span>}
                  <strong className={serviceStatus === 'failing' && count > 0 ? 'failure-count' : undefined}>{count}</strong>
                  {' '}{statusLabels[serviceStatus].toLowerCase()}
                </span>
              );
            })}
          </div>
        </div>

        <section aria-label="Service overview">
          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">Search services by name or URL</span>
              <input type="search" placeholder="Search name or URL…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label className="filter-field">
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as ServiceStatus | 'all')}>
                <option value="all">All services</option>
                {(Object.keys(statusLabels) as ServiceStatus[]).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
              </select>
            </label>
            {filtersActive && <button type="button" className="clear-button" onClick={clearFilters}>Clear filters</button>}
            <label className="filter-field uptime-filter">
              <span>Uptime window</span>
              <select value={uptimeWindow} onChange={(event) => setUptimeWindow(event.target.value as UptimeWindow)}>
                {(Object.keys(uptimeWindows) as UptimeWindow[]).map((value) => <option key={value} value={value}>{uptimeWindows[value]}</option>)}
              </select>
            </label>
          </div>

          <div className="table-scroll" role="region" aria-label="Services table, scroll horizontally on small screens" tabIndex={0}>
            <table className="overview-table">
              <caption className="sr-only">Service monitoring overview. Uptime over {uptimeWindows[uptimeWindow]}.</caption>
              <thead>
                <tr>
                  <th scope="col">Service / endpoint</th>
                  <th scope="col">Monitoring</th>
                  <th scope="col">Last result</th>
                  <th scope="col" className="numeric">Duration</th>
                  <th scope="col" className="numeric">Uptime {uptimeWindow}</th>
                  <th scope="col">Last checked</th>
                  <th scope="col" className="numeric">Interval</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((service) => {
                  const history = serviceHistories.get(service.id) ?? [];
                  const uptime = summarizeHistory(historyForWindow(history, uptimeWindow)).uptime;
                  return (
                    <Fragment key={service.id}>
                      <tr>
                        <th scope="row" className="service-cell"><span className="service-name">{service.name}</span><span className="endpoint">{service.url}</span></th>
                        <td><span className="monitoring-state"><span className={`status-dot ${service.status}`} aria-hidden="true" />{service.status === 'paused' ? 'Paused' : 'Enabled'}</span></td>
                        <td className={service.status === 'failing' ? 'failure-result' : ''}>{service.result}</td>
                        <td className="numeric metric">{service.durationMs === null ? '—' : `${service.durationMs} ms`}</td>
                        <td className="numeric metric">{uptime === null ? '—' : `${uptime.toFixed(2)}%`}</td>
                        <td className="last-checked">{service.lastChecked}</td>
                        <td className="numeric metric">{service.intervalSeconds} s</td>
                        <td><button id={`service-toggle-${service.id}`} type="button" aria-label={`${expandedId === service.id ? 'Close' : 'Show'} details for ${service.name}`} aria-expanded={expandedId === service.id} aria-controls={expandedId === service.id ? `service-detail-${service.id}` : undefined} onClick={() => setExpandedId(expandedId === service.id ? null : service.id)}>{expandedId === service.id ? 'Close details' : 'Details'}</button></td>
                      </tr>
                      {expandedId === service.id && <tr className="detail-row"><td colSpan={8}>
                        <ServiceDetail service={service} history={history} onClose={() => closeDetails(service.id)} onUpdate={(updated) => setServiceList((current) => current.map((item) => item.id === updated.id ? updated : item))} onDelete={() => { setServiceList((current) => current.filter((item) => item.id !== service.id)); setExpandedId(null); }} />
                      </td></tr>}
                    </Fragment>
                  );
                })}
                {filteredServices.length === 0 && <tr><td colSpan={8} className="empty-state"><strong>{serviceList.length === 0 ? 'No services' : 'No matching services'}</strong><span>{serviceList.length === 0 ? 'There are no services to display.' : 'Try a different name, URL, or status.'}</span>{filtersActive && <button type="button" onClick={clearFilters}>Clear filters</button>}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span role="status">Showing {filteredServices.length} of {serviceList.length} services</span>
          </div>
        </section>

      </main>
    </>
  );
}
