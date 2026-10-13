import { Fragment, useEffect, useRef, useState } from 'react';
import { AddService } from './AddService';
import type { NewService } from './AddService';
import { ServiceDetail } from './ServiceDetail';
import {
  createService,
  loadOverview,
  removeService,
  toService,
  updateService,
} from './api';
import type { Service, ServiceStatus, UptimeWindow } from './types';

const statusLabels: Record<ServiceStatus, string> = {
  healthy: 'Healthy',
  failing: 'Failing',
  pending: 'Awaiting check',
  paused: 'Paused',
};
const uptimeWindows: Record<UptimeWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};
export function App() {
  const [addingService, setAddingService] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const overviewRequest = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serviceList, setServiceList] = useState<Service[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServiceStatus | 'all'>('all');
  const [uptimeWindow, setUptimeWindow] = useState<UptimeWindow>('24h');
  useEffect(() => {
    const controller = new AbortController();
    overviewRequest.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setLoadError('');
    async function refresh() {
      try {
        const services = await loadOverview(uptimeWindow, controller.signal);
        if (!controller.signal.aborted) {
          setServiceList(services);
          setLoadError('');
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load services.',
          );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(refresh, 10_000);
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [uptimeWindow, revision]);

  function refreshOverview() {
    overviewRequest.current?.abort();
    setRevision((current) => current + 1);
  }

  const query = search.trim().toLowerCase();
  const filteredServices = serviceList.filter(
    (service) =>
      (status === 'all' || service.status === status) &&
      `${service.name} ${service.url}`.toLowerCase().includes(query),
  );
  const filtersActive = search !== '' || status !== 'all';

  function clearFilters() {
    setSearch('');
    setStatus('all');
  }

  function closeDetails(id: number) {
    setExpandedId(null);
    requestAnimationFrame(() =>
      document.getElementById(`service-toggle-${id}`)?.focus(),
    );
  }

  function closeAddService() {
    setAddingService(false);
    requestAnimationFrame(() => addButton.current?.focus());
  }

  async function addService(input: NewService) {
    const stored = await createService(input);
    setServiceList((current) => [...current, toService(stored)]);
    clearFilters();
    setExpandedId(null);
    closeAddService();
    refreshOverview();
  }

  async function saveService(updated: Service) {
    const stored = await updateService(updated);
    setServiceList((current) =>
      current.map((item) =>
        item.id === stored.id
          ? toService(
              stored,
              item.latestCheck ?? null,
              item.uptimePercent ?? null,
            )
          : item,
      ),
    );
    refreshOverview();
  }

  async function deleteService(id: number) {
    await removeService(id);
    setServiceList((current) => current.filter((item) => item.id !== id));
    setExpandedId(null);
    refreshOverview();
  }

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <span className="brand">
            sentinel
            <span className="brand-mark" aria-hidden="true">
              _
            </span>
          </span>
          <span className="header-context">Service monitoring</span>
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <h1>Services</h1>
            <p>HTTP availability and recent check results.</p>
          </div>
          <button
            ref={addButton}
            type="button"
            onClick={() => setAddingService(true)}
          >
            Add service
          </button>
        </div>

        <div className="summary" aria-label="Service summary">
          <span className="summary-total">
            <strong>{serviceList.length}</strong> services
          </span>
          <div className="summary-breakdown">
            {(Object.keys(statusLabels) as ServiceStatus[]).map(
              (serviceStatus, index) => {
                const count = serviceList.filter(
                  (service) => service.status === serviceStatus,
                ).length;
                return (
                  <span key={serviceStatus}>
                    {index > 0 && (
                      <span className="summary-separator" aria-hidden="true">
                        /
                      </span>
                    )}
                    <strong
                      className={
                        serviceStatus === 'failing' && count > 0
                          ? 'failure-count'
                          : undefined
                      }
                    >
                      {count}
                    </strong>{' '}
                    {statusLabels[serviceStatus].toLowerCase()}
                  </span>
                );
              },
            )}
          </div>
        </div>

        <section aria-label="Service overview" aria-busy={loading}>
          {loadError && (
            <p role="alert" className="failure-result">
              {loadError}{' '}
              <button type="button" onClick={refreshOverview}>
                Retry
              </button>
            </p>
          )}
          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">Search services by name or URL</span>
              <input
                type="search"
                placeholder="Search name or URL…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ServiceStatus | 'all')
                }
              >
                <option value="all">All services</option>
                {(Object.keys(statusLabels) as ServiceStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {statusLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            {filtersActive && (
              <button
                type="button"
                className="clear-button"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            )}
            <label className="filter-field uptime-filter">
              <span>Uptime window</span>
              <select
                value={uptimeWindow}
                onChange={(event) =>
                  setUptimeWindow(event.target.value as UptimeWindow)
                }
              >
                {(Object.keys(uptimeWindows) as UptimeWindow[]).map((value) => (
                  <option key={value} value={value}>
                    {uptimeWindows[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="table-scroll"
            role="region"
            aria-label="Services table, scroll horizontally on small screens"
            tabIndex={0}
          >
            <table className="overview-table">
              <caption className="sr-only">
                Service monitoring overview. Uptime over{' '}
                {uptimeWindows[uptimeWindow]}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Service / endpoint</th>
                  <th scope="col">Monitoring</th>
                  <th scope="col">Last result</th>
                  <th scope="col" className="numeric">
                    Duration
                  </th>
                  <th scope="col" className="numeric">
                    Uptime {uptimeWindow}
                  </th>
                  <th scope="col">Last checked</th>
                  <th scope="col" className="numeric">
                    Interval
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((service) => {
                  const uptime = service.uptimePercent ?? null;
                  return (
                    <Fragment key={service.id}>
                      <tr>
                        <th scope="row" className="service-cell">
                          <span className="service-name">{service.name}</span>
                          <span className="endpoint">{service.url}</span>
                        </th>
                        <td>
                          <span className="monitoring-state">
                            <span
                              className={`status-dot ${service.status}`}
                              aria-hidden="true"
                            />
                            {service.status === 'paused' ? 'Paused' : 'Enabled'}
                          </span>
                        </td>
                        <td
                          className={
                            service.status === 'failing' ? 'failure-result' : ''
                          }
                        >
                          {service.result}
                        </td>
                        <td className="numeric metric">
                          {service.durationMs === null
                            ? '—'
                            : `${Math.round(service.durationMs)} ms`}
                        </td>
                        <td className="numeric metric">
                          {loading || loadError || uptime === null
                            ? '—'
                            : `${uptime.toFixed(2)}%`}
                        </td>
                        <td className="last-checked">{service.lastChecked}</td>
                        <td className="numeric metric">
                          {service.intervalSeconds} s
                        </td>
                        <td>
                          <button
                            id={`service-toggle-${service.id}`}
                            type="button"
                            hidden={expandedId === service.id}
                            aria-label={`Show details for ${service.name}`}
                            onClick={() => setExpandedId(service.id)}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                      {expandedId === service.id && (
                        <tr className="detail-row">
                          <td colSpan={8}>
                            <ServiceDetail
                              service={service}
                              refreshKey={revision}
                              onClose={() => closeDetails(service.id)}
                              onUpdate={saveService}
                              onDelete={() => deleteService(service.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {loading && serviceList.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-state" role="status">
                      Loading services…
                    </td>
                  </tr>
                )}
                {!loading && !loadError && filteredServices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      <strong>
                        {serviceList.length === 0
                          ? 'No services'
                          : 'No matching services'}
                      </strong>
                      <span>
                        {serviceList.length === 0
                          ? 'There are no services to display.'
                          : 'Try a different name, URL, or status.'}
                      </span>
                      {filtersActive && (
                        <button type="button" onClick={clearFilters}>
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span role="status">
              Showing {filteredServices.length} of {serviceList.length} services
            </span>
          </div>
        </section>
      </main>
      {addingService && (
        <AddService onClose={closeAddService} onSave={addService} />
      )}
    </>
  );
}
