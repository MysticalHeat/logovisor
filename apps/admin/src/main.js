import './style.css';

const state = {
  operator: null,
  agents: [],
  agentDetails: new Map(),
  selectedAgentId: null,
  agentTokens: [],
  enrollmentTokens: [],
  logs: [],
  logsCursor: null,
  alertIntegrations: [],
  alertRules: [],
  alertDslMetadata: null,
  alertIncidents: [],
  alertSilences: [],
  alertNotifications: [],
  analyticsOverview: null,
  analyticsLogs: null,
  analyticsSystem: null,
  activeSection: 'fleet',
};

const sectionCopy = {
  fleet: ['Fleet', 'Agent health, runtime tokens, and latest host metrics.'],
  logs: ['Logs', 'Search ingested log events with cursor-based pagination.'],
  analytics: ['Analytics', 'Aggregated log volume and host resource trends over time.'],
  alerts: ['Alerts', 'Telegram integrations, DSL rules, and validation hints.'],
  tokens: ['Tokens', 'Create, inspect, and revoke enrollment bootstrap tokens.'],
};

const analyticsRanges = ['1h', '6h', '24h', '7d'];

const loginShell = document.getElementById('login-shell');
const appShell = document.getElementById('app-shell');
const loginError = document.getElementById('login-error');
const appErrorBanner = document.getElementById('app-error-banner');

function bytesToGiB(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return value.toFixed(digits);
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPercent(value, digits = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return `${value.toFixed(digits)}%`;
}

function formatCompactNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMetrics(system) {
  if (!system) return '<span class="muted">No metrics yet</span>';
  return [
    `CPU ${formatNumber(system.cpuPercent, 1)}%`,
    `Load ${formatNumber(system.load1)}/${formatNumber(system.load5)}/${formatNumber(system.load15)}`,
    `Mem ${bytesToGiB(system.memoryUsedBytes)} / ${bytesToGiB(system.memoryTotalBytes)}`,
    `Swap ${bytesToGiB(system.swapUsedBytes)} / ${bytesToGiB(system.swapTotalBytes)}`,
    `Disk ${bytesToGiB(system.diskUsedBytes)} / ${bytesToGiB(system.diskTotalBytes)}`,
    `Net RX ${bytesToGiB(system.networkRxBytes)} | TX ${bytesToGiB(system.networkTxBytes)}`,
    `Uptime ${formatNumber(system.uptimeSeconds, 0)}s`,
  ].join('\n');
}

function averageOf(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json();
}

async function readApiError(response) {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text);
    return (
      parsed?.error?.message ||
      parsed?.message ||
      text ||
      `Request failed with status ${response.status}`
    );
  } catch {
    return text || `Request failed with status ${response.status}`;
  }
}

function setSection(section) {
  state.activeSection = section;
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === section);
  });
  document.querySelectorAll('.section').forEach((element) => {
    element.classList.toggle('active', element.id === `section-${section}`);
  });
  document.getElementById('section-title').textContent = sectionCopy[section][0];
  document.getElementById('section-subtitle').textContent = sectionCopy[section][1];
}

async function refreshSession() {
  try {
    const me = await api('/auth/me');
    state.operator = me;
    document.getElementById('operator-label').textContent = `signed in as ${me.username}`;
    loginShell.classList.add('hidden');
    appShell.classList.remove('hidden');
    clearAppError();
    await refreshAll();
  } catch (error) {
    loginShell.classList.remove('hidden');
    appShell.classList.add('hidden');
    if (error?.message === 'missing operator session') {
      loginError.textContent = '';
    } else {
      loginError.textContent = state.operator ? error?.message || '' : '';
    }
  }
}

async function refreshAll() {
  const results = await Promise.allSettled([
    refreshAgents(),
    refreshEnrollmentTokens(),
    refreshAnalytics(),
    refreshAlertIntegrations(),
    refreshAlertRules(),
    refreshAlertDslMetadata(),
    refreshAlertIncidents(),
    refreshAlertSilences(),
    refreshAlertNotifications(),
  ]);

  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason));

  if (failures.length) {
    showAppError(`Some data failed to load: ${failures[0]}`);
  } else {
    clearAppError();
  }
}

function showAppError(message) {
  appErrorBanner.textContent = message;
  appErrorBanner.classList.remove('hidden');
}

function clearAppError() {
  appErrorBanner.textContent = '';
  appErrorBanner.classList.add('hidden');
}

function currentAnalyticsQuery() {
  const params = new URLSearchParams();
  const range = document.getElementById('analytics-range')?.value || '24h';
  const hostId = document.getElementById('analytics-host-filter')?.value.trim();
  const agentId = document.getElementById('analytics-agent-filter')?.value.trim();
  if (range && analyticsRanges.includes(range)) params.set('range', range);
  if (hostId) params.set('hostId', hostId);
  if (agentId) params.set('agentId', agentId);
  return params.toString();
}

async function refreshAnalytics() {
  const query = currentAnalyticsQuery();
  const suffix = query ? `?${query}` : '';
  const [overview, logs, system] = await Promise.all([
    api(`/admin/analytics/overview${suffix}`),
    api(`/admin/analytics/logs${suffix}`),
    api(`/admin/analytics/system${suffix}`),
  ]);
  state.analyticsOverview = overview;
  state.analyticsLogs = logs;
  state.analyticsSystem = system;
  renderAnalytics();
}

async function refreshAlertIntegrations() {
  const list = await api('/admin/alerts/telegram/integrations');
  state.alertIntegrations = list.items || [];
  renderAlertIntegrations();
}

async function refreshAlertRules() {
  const list = await api('/admin/alerts/rules');
  state.alertRules = list.items || [];
  renderAlertRules();
}

async function refreshAlertDslMetadata() {
  state.alertDslMetadata = await api('/admin/alerts/dsl-metadata');
  renderAlertDslMetadata();
}

async function refreshAlertIncidents() {
  const list = await api('/admin/alerts/incidents');
  state.alertIncidents = list.items || [];
  renderAlertIncidents();
}

async function refreshAlertSilences() {
  const list = await api('/admin/alerts/silences');
  state.alertSilences = list.items || [];
  renderAlertSilences();
}

async function refreshAlertNotifications() {
  const list = await api('/admin/alerts/notifications');
  state.alertNotifications = list.items || [];
  renderAlertNotifications();
}

function currentAgentQuery() {
  const search = document.getElementById('agent-search').value.trim();
  const status = document.getElementById('agent-status-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('limit', '50');
  return params.toString();
}

async function refreshAgents() {
  const query = currentAgentQuery();
  const list = await api(`/admin/agents${query ? `?${query}` : ''}`);
  state.agents = list.items || [];
  state.agentDetails.clear();

  const details = await Promise.all(state.agents.map((agent) => api(`/admin/agents/${agent.id}`)));
  details.forEach((detail) => state.agentDetails.set(detail.id, detail));

  if (!state.selectedAgentId || !state.agentDetails.has(state.selectedAgentId)) {
    state.selectedAgentId = details[0]?.id ?? null;
  }

  if (state.selectedAgentId) {
    await refreshAgentTokens(state.selectedAgentId);
  }

  renderAnalyticsAgentSelector();
  renderFleet();
}

function renderAnalyticsAgentSelector() {
  const select = document.getElementById('analytics-agent-filter');
  if (!select) {
    return;
  }

  const currentValue = select.value;
  const options = Array.from(state.agentDetails.values())
    .sort((left, right) => left.hostId.localeCompare(right.hostId))
    .map(
      (detail) =>
        `<option value="${escapeHtml(detail.id)}">${escapeHtml(detail.hostId)} · ${escapeHtml(detail.hostname)}</option>`,
    )
    .join('');

  select.innerHTML = `<option value="">all matched agents</option>${options}`;
  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

async function refreshAgentTokens(agentId) {
  state.agentTokens = (await api(`/admin/agents/${agentId}/tokens`)).items || [];
  renderAgentTokens();
}

async function refreshEnrollmentTokens() {
  state.enrollmentTokens = (await api('/admin/enrollment-tokens')).items || [];
  renderEnrollmentTokens();
}

function renderFleet() {
  const total = state.agents.length;
  const online = state.agents.filter((agent) => agent.status === 'online').length;
  const offline = total - online;
  const avgCpu = averageOf(
    Array.from(state.agentDetails.values()).map((detail) => detail.latestHeartbeat?.system?.cpuPercent),
  );
  const avgMem = averageOf(
    Array.from(state.agentDetails.values()).map((detail) => {
      const system = detail.latestHeartbeat?.system;
      if (!system || !system.memoryTotalBytes) return null;
      return (system.memoryUsedBytes / system.memoryTotalBytes) * 100;
    }),
  );

  document.getElementById('fleet-kpis').innerHTML = [
    ['Agents', total],
    ['Online', online],
    ['Offline', offline],
    ['Avg CPU', `${formatNumber(avgCpu, 1)}%`],
    ['Avg Mem', `${formatNumber(avgMem, 1)}%`],
  ]
    .map(([label, value]) => `<div class="kpi"><span class="muted">${label}</span><strong>${value}</strong></div>`)
    .join('');

  const details = Array.from(state.agentDetails.values());
  document.getElementById('agents-output').innerHTML = details.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Host ID</th>
            <th>Status</th>
            <th>Hostname</th>
            <th>OS</th>
            <th>Last seen</th>
            <th>Metrics</th>
          </tr>
        </thead>
        <tbody>
          ${details
            .map((detail) => `
              <tr>
                <td><button class="agent-select" data-agent-id="${detail.id}"><code>${escapeHtml(detail.hostId)}</code></button></td>
                <td class="${detail.status === 'online' ? 'status-online' : 'status-offline'}">${detail.status}</td>
                <td>${escapeHtml(detail.hostname)}</td>
                <td>${escapeHtml(detail.os)}</td>
                <td>${escapeHtml(formatDate(detail.lastSeenAt))}</td>
                <td class="metrics">${renderMetrics(detail.latestHeartbeat?.system)}</td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No agents found.</div>';

  document.querySelectorAll('[data-agent-id]').forEach((button) => {
    button.onclick = async () => {
      state.selectedAgentId = button.dataset.agentId;
      await refreshAgentTokens(state.selectedAgentId);
      renderAgentDrawer();
      openDrawer();
    };
  });

  renderAgentDrawer();
}

function renderAgentDrawer() {
  const detail = state.agentDetails.get(state.selectedAgentId);
  if (!detail) {
    document.getElementById('agent-detail').innerHTML = '<div class="empty">Select an agent to inspect details.</div>';
    renderAgentTokens();
    return;
  }

  const heartbeats = detail.recentHeartbeats || [];
  const agentMetricPoints = [...heartbeats].reverse().map((heartbeat) => ({
    label: heartbeat.receivedAt,
    firstValue: heartbeat.system?.cpuPercent || 0,
    secondValue: heartbeatMemoryPercent(heartbeat.system),
  }));

  document.getElementById('drawer-title').textContent = `${detail.hostId} details`;
  document.getElementById('drawer-subtitle').textContent = `${detail.hostname} · ${detail.os}`;
  document.getElementById('agent-detail').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span class="muted">Agent ID</span><code>${escapeHtml(detail.id)}</code></div>
      <div class="detail-card"><span class="muted">Installation ID</span><code>${escapeHtml(detail.installationId)}</code></div>
      <div class="detail-card"><span class="muted">Last seen</span><strong>${escapeHtml(formatDate(detail.lastSeenAt))}</strong></div>
      <div class="detail-card"><span class="muted">Status</span><strong class="${detail.status === 'online' ? 'status-online' : 'status-offline'}">${detail.status}</strong></div>
    </div>
    <div class="panel top-gap">
      <h3>Latest heartbeat snapshot</h3>
      <pre class="metrics">${escapeHtml(renderMetrics(detail.latestHeartbeat?.system).replace(/<[^>]+>/g, ''))}</pre>
    </div>
    <div class="panel top-gap panel-dark">
      <h3>CPU / Memory history</h3>
      <p class="muted analytics-panel-copy">Recent heartbeat snapshots for this agent.</p>
      ${renderDualMetricChart(agentMetricPoints, {
        title: `${detail.hostId} CPU and memory history`,
        firstLabel: 'CPU',
        secondLabel: 'Memory',
        firstColor: '#38bdf8',
        secondColor: '#a855f7',
        gradientId: 'agent-cpu-memory-gradient',
        maxValue: 100,
        valueFormatter: (value) => `${Math.round(value)}%`,
      })}
    </div>
    <div class="panel top-gap">
      <h3>Recent heartbeats</h3>
      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>Health</th>
            <th>Queue</th>
            <th>System snapshot</th>
          </tr>
        </thead>
        <tbody>
          ${heartbeats
            .map((heartbeat) => `
              <tr>
                <td>${escapeHtml(formatDate(heartbeat.receivedAt))}</td>
                <td>${escapeHtml(heartbeat.health)}</td>
                <td>${escapeHtml(String(heartbeat.queueDepth))}</td>
                <td class="metrics">${renderMetrics(heartbeat.system)}</td>
              </tr>`)
            .join('')}
        </tbody>
      </table>
    </div>`;

  renderAgentTokens();
}

function renderAgentTokens() {
  if (!state.selectedAgentId) {
    document.getElementById('agent-tokens').innerHTML = '<div class="empty">Select an agent to inspect runtime tokens.</div>';
    return;
  }

  document.getElementById('agent-tokens').innerHTML = state.agentTokens.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Prefix</th>
            <th>Created</th>
            <th>Revoked</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.agentTokens
            .map((token) => `
              <tr>
                <td><code>${escapeHtml(token.tokenPrefix)}</code></td>
                <td>${escapeHtml(formatDate(token.createdAt))}</td>
                <td>${token.revokedAt ? escapeHtml(formatDate(token.revokedAt)) : '<span class="muted">active</span>'}</td>
                <td>${token.revokedAt ? '' : `<button class="warn" data-revoke-agent-token="${token.id}">Revoke</button>`}</td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No runtime tokens found.</div>';

  document.querySelectorAll('[data-revoke-agent-token]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/agents/${state.selectedAgentId}/tokens/${button.dataset.revokeAgentToken}/revoke`, { method: 'POST' });
      await refreshAgentTokens(state.selectedAgentId);
    };
  });
}

async function runLogSearch(resetCursor = true) {
  if (resetCursor) state.logsCursor = null;

  const params = new URLSearchParams();
  const pairs = [
    ['query', document.getElementById('logs-query').value.trim()],
    ['hostId', document.getElementById('logs-host-id').value.trim()],
    ['agentId', document.getElementById('logs-agent-id').value.trim()],
    ['sourceType', document.getElementById('logs-source-type').value],
    ['level', document.getElementById('logs-level').value],
    ['from', document.getElementById('logs-from').value.trim()],
    ['to', document.getElementById('logs-to').value.trim()],
  ];

  pairs.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set('limit', '50');
  if (state.logsCursor) {
    params.set('beforeTimestamp', state.logsCursor.beforeTimestamp);
    params.set('beforeEventId', state.logsCursor.beforeEventId);
  }

  const result = await api(`/admin/logs/search?${params.toString()}`);
  state.logs = resetCursor ? result.items : [...state.logs, ...result.items];
  state.logsCursor = result.nextCursor || null;
  renderLogs();
}

function renderLogs() {
  document.getElementById('logs-output').innerHTML = state.logs.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Host ID</th>
            <th>Source</th>
            <th>Level</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${state.logs
            .map((row) => `
              <tr>
                <td>${escapeHtml(formatDate(row.timestamp))}</td>
                <td><code>${escapeHtml(row.hostId)}</code></td>
                <td>${escapeHtml(row.sourceType)}</td>
                <td>${escapeHtml(row.level || '—')}</td>
                <td>
                  <div>${escapeHtml(row.message)}</div>
                  <details>
                    <summary class="muted">event details</summary>
                    <pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>
                  </details>
                </td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No log events loaded yet.</div>';

  document.getElementById('load-more-logs').classList.toggle('hidden', !state.logsCursor);
}

function renderBar(value, max) {
  const width = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
  return `<div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeChartPoints(values, width, height, max) {
  if (!values.length || max <= 0) return [];
  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: height - (value / max) * height,
    value,
    index,
  }));
}

function createSmoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const path = [`M ${points[0].x} ${points[0].y}`];
  const tension = 0.2;

  for (let index = 0; index < points.length - 1; index += 1) {
    const prev = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const nextNext = points[index + 2] ?? next;

    const cp1x = current.x + (next.x - prev.x) * tension;
    const cp1y = current.y + (next.y - prev.y) * tension;
    const cp2x = next.x - (nextNext.x - current.x) * tension;
    const cp2y = next.y - (nextNext.y - current.y) * tension;

    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }

  return path.join(' ');
}

function buildAreaPath(points, height) {
  if (!points.length) return '';
  const curve = createSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${curve} L ${last.x} ${height} L ${first.x} ${height} Z`;
}

function chartLabel(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function heartbeatMemoryPercent(system) {
  if (!system || !system.memoryTotalBytes) {
    return 0;
  }

  return (system.memoryUsedBytes / system.memoryTotalBytes) * 100;
}

function renderDualMetricChart(points, options) {
  if (!points?.length) {
    return '<div class="empty">No metric history yet.</div>';
  }

  const width = 960;
  const height = 220;
  const firstSeries = points.map((point) => point.firstValue || 0);
  const secondSeries = points.map((point) => point.secondValue || 0);
  const max = Math.max(...firstSeries, ...secondSeries, options.maxValue ?? 100, 0);
  const firstPoints = normalizeChartPoints(firstSeries, width, height, max);
  const secondPoints = normalizeChartPoints(secondSeries, width, height, max);
  const firstPath = createSmoothPath(firstPoints);
  const secondPath = createSmoothPath(secondPoints);
  const firstArea = buildAreaPath(firstPoints, height);
  const labels = points
    .map((point, index) => {
      if (index !== 0 && index !== points.length - 1 && index % Math.ceil(points.length / 6) !== 0) {
        return '';
      }

      return `<span class="chart-x-label muted">${escapeHtml(chartLabel(point.label))}</span>`;
    })
    .join('');

  return `
    <div class="chart-shell agent-metric-chart-shell">
      <div class="chart-body">
        <div class="chart-y-axis muted">
          ${Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * (4 - index)))
            .map((tick) => `<span>${escapeHtml(options.valueFormatter ? options.valueFormatter(tick) : formatCompactNumber(tick))}</span>`)
            .join('')}
        </div>
        <div class="chart-canvas-wrap compact-chart-canvas">
          <svg class="line-chart compact-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(options.title)}">
            <defs>
              <linearGradient id="${escapeHtml(options.gradientId)}" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="${escapeHtml(options.firstColor)}" stop-opacity="0.28" />
                <stop offset="100%" stop-color="${escapeHtml(options.firstColor)}" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            ${Array.from({ length: 5 }, (_, index) => {
              const y = (height / 4) * index;
              return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" class="chart-grid-line"></line>`;
            }).join('')}
            <path d="${firstArea}" fill="url(#${escapeHtml(options.gradientId)})"></path>
            <path d="${firstPath}" class="chart-line" style="stroke:${escapeHtml(options.firstColor)}"></path>
            <path d="${secondPath}" class="chart-line" style="stroke:${escapeHtml(options.secondColor)}"></path>
          </svg>
        </div>
      </div>
      <div class="chart-x-axis">${labels}</div>
      <div class="chart-legend left-legend">
        <span class="chart-legend-item"><i class="legend-dot" style="background:${escapeHtml(options.firstColor)}"></i>${escapeHtml(options.firstLabel)}</span>
        <span class="chart-legend-item"><i class="legend-dot" style="background:${escapeHtml(options.secondColor)}"></i>${escapeHtml(options.secondLabel)}</span>
      </div>
    </div>`;
}

function attachVolumeChartInteractions(points) {
  const root = document.getElementById('analytics-log-volume-output');
  const shell = root?.querySelector('.interactive-chart');
  const overlay = shell?.querySelector('.chart-hover-overlay');
  const crosshair = shell?.querySelector('.chart-crosshair');
  const dotTotal = shell?.querySelector('.chart-active-dot-total');
  const dotWarn = shell?.querySelector('.chart-active-dot-warn');
  const dotError = shell?.querySelector('.chart-active-dot-error');
  const tooltip = shell?.querySelector('.chart-tooltip');

  if (!shell || !overlay || !crosshair || !dotTotal || !dotWarn || !dotError || !tooltip || !points.length) {
    return;
  }

  let frame = 0;

  const hide = () => {
    crosshair.classList.add('hidden');
    dotTotal.classList.add('hidden');
    dotWarn.classList.add('hidden');
    dotError.classList.add('hidden');
    tooltip.classList.add('hidden');
  };

  const update = (event) => {
    const rect = overlay.getBoundingClientRect();
    const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
    const ratio = rect.width > 0 ? relativeX / rect.width : 0;
    const index = clamp(Math.round(ratio * (points.length - 1)), 0, points.length - 1);
    const point = points[index];
    const left = `${(point.x / 960) * 100}%`;

    crosshair.setAttribute('x1', String(point.x));
    crosshair.setAttribute('x2', String(point.x));
    crosshair.classList.remove('hidden');

    [
      [dotTotal, point.totalY],
      [dotWarn, point.warnY],
      [dotError, point.errorY],
    ].forEach(([element, y]) => {
      element.setAttribute('cx', String(point.x));
      element.setAttribute('cy', String(y));
      element.classList.remove('hidden');
    });

    tooltip.innerHTML = `
      <div class="chart-tooltip-title">${escapeHtml(formatDate(point.bucketStart))}</div>
      <div class="chart-tooltip-row"><span><i class="legend-dot legend-dot-total"></i>Total</span><strong>${escapeHtml(formatCompactNumber(point.totalLogs))}</strong></div>
      <div class="chart-tooltip-row"><span><i class="legend-dot legend-dot-warn"></i>Warnings</span><strong>${escapeHtml(formatCompactNumber(point.warnLogs))}</strong></div>
      <div class="chart-tooltip-row"><span><i class="legend-dot legend-dot-error"></i>Errors</span><strong>${escapeHtml(formatCompactNumber(point.errorLogs))}</strong></div>`;
    tooltip.classList.remove('hidden');

    const tooltipRect = tooltip.getBoundingClientRect();
    const idealLeft = event.clientX - rect.left + 18;
    const boundedLeft = clamp(idealLeft, 12, rect.width - tooltipRect.width - 12);
    const idealTop = event.clientY - rect.top - tooltipRect.height - 14;
    tooltip.style.left = `${boundedLeft}px`;
    tooltip.style.top = `${idealTop > 8 ? idealTop : 8}px`;
    tooltip.dataset.activeIndex = String(index);
    shell.style.setProperty('--chart-active-left', left);
  };

  overlay.onmousemove = (event) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => update(event));
  };
  overlay.onmouseenter = (event) => update(event);
  overlay.onmouseleave = () => {
    cancelAnimationFrame(frame);
    hide();
  };

  hide();
}

function polarToCartesian(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [`M`, start.x, start.y, `A`, radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
}

function renderHostDonut(logs, system) {
  const hosts = (logs.topHosts || []).slice(0, 8);
  if (!hosts.length) {
    return '<div class="empty">No host analytics in this range.</div>';
  }

  const palette = ['#a855f7', '#14b8a6', '#f59e0b', '#38bdf8', '#f97316', '#ec4899', '#8b5cf6', '#22c55e'];
  const total = hosts.reduce((sum, host) => sum + (host.count || 0), 0);
  let angle = 0;
  const latestMap = new Map((system.latestByHost || []).map((item) => [item.hostId, item]));

  const segments = hosts.map((host, index) => {
    const share = total > 0 ? (host.count / total) * 100 : 0;
    const sweep = total > 0 ? (host.count / total) * 360 : 0;
    const path = describeArc(110, 110, 74, angle, angle + sweep);
    const segment = {
      ...host,
      share,
      color: palette[index % palette.length],
      path,
      latest: latestMap.get(host.hostId),
    };
    angle += sweep;
    return segment;
  });

  const primary = segments[0];

  return `
    <div class="hosts-analytics-layout">
      <div class="donut-chart-card">
        <svg class="host-donut" viewBox="0 0 220 220" aria-label="log distribution by host">
          <circle cx="110" cy="110" r="74" class="host-donut-base"></circle>
          ${segments.map((segment, index) => `<path d="${segment.path}" class="host-donut-segment" data-donut-host="${escapeHtml(segment.hostId)}" data-donut-index="${index}" stroke="${segment.color}" title="${escapeHtml(`${segment.hostId}: ${formatCompactNumber(segment.count)} logs (${segment.share.toFixed(1)}%)`)}"></path>`).join('')}
          <circle cx="110" cy="110" r="52" class="host-donut-hole"></circle>
          <text x="110" y="103" text-anchor="middle" class="host-donut-total-label">Top host</text>
          <text x="110" y="128" text-anchor="middle" class="host-donut-total-value">${escapeHtml(primary.hostId)}</text>
        </svg>
      </div>
      <div class="host-legend-list">
        ${segments.map((segment, index) => `
          <button class="host-legend-item" data-analytics-host="${escapeHtml(segment.hostId)}" data-donut-index="${index}">
            <span class="host-legend-marker" style="background:${segment.color}"></span>
            <span class="host-legend-main">
              <strong>${escapeHtml(segment.hostId)}</strong>
              <span class="muted">${escapeHtml(segment.latest?.hostname || 'host')}</span>
            </span>
            <span class="host-legend-stats">
              <span>${escapeHtml(formatCompactNumber(segment.count))}</span>
              <span class="muted">${escapeHtml(formatNumber(segment.share, 1))}%</span>
            </span>
          </button>`).join('')}
      </div>
      <div class="top-gap host-latest-grid">
        ${(system.latestByHost || [])
          .slice(0, 6)
          .map((row) => `
            <div class="detail-card analytics-detail-card host-mini-card">
              <div class="row-actions host-mini-head">
                <code>${escapeHtml(row.hostId)}</code>
                <span class="muted">${escapeHtml(row.health)}</span>
              </div>
              <div class="muted">${escapeHtml(row.hostname)}</div>
              <div class="host-mini-metrics top-gap">
                <span>CPU ${escapeHtml(formatPercent(row.cpuPercent))}</span>
                <span>Mem ${escapeHtml(formatPercent(row.memoryUsedPercent))}</span>
                <span>Disk ${escapeHtml(formatPercent(row.diskUsedPercent))}</span>
              </div>
            </div>`)
          .join('')}
      </div>
    </div>`;
}

function attachHostDonutInteractions() {
  const root = document.getElementById('analytics-hosts-output');
  if (!root) return;

  const activate = (index, active) => {
    root.querySelectorAll(`[data-donut-index="${index}"]`).forEach((element) => {
      element.classList.toggle('is-active', active);
    });
  };

  root.querySelectorAll('.host-legend-item').forEach((element) => {
    const { donutIndex } = element.dataset;
    element.onmouseenter = () => activate(donutIndex, true);
    element.onmouseleave = () => activate(donutIndex, false);
  });

  root.querySelectorAll('.host-donut-segment').forEach((element) => {
    const { donutIndex } = element.dataset;
    element.onmouseenter = () => activate(donutIndex, true);
    element.onmouseleave = () => activate(donutIndex, false);
  });
}

function analyticsBars(items, valueFormatter = (value) => String(value), clickAttr = '') {
  if (!items?.length) {
    return '<div class="empty">No analytics data in this range.</div>';
  }

  const max = Math.max(...items.map((item) => item.count || 0), 0);
  return `
    <table>
      <thead>
        <tr>
          <th>Key</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map((item) => `
            <tr>
              <td>
                ${clickAttr
                  ? `<button class="link-button" ${clickAttr}="${escapeHtml(item.key)}">${escapeHtml(item.key)}</button>`
                  : escapeHtml(item.key)}
                ${renderBar(item.count || 0, max)}
              </td>
              <td>${escapeHtml(valueFormatter(item.count || 0))}</td>
            </tr>`)
          .join('')}
      </tbody>
    </table>`;
}

function renderMiniTrend(points, key, formatter = (value) => String(value)) {
  if (!points?.length) {
    return '<div class="empty">No timeline data in this range.</div>';
  }

  const max = Math.max(...points.map((point) => point[key] || 0), 0);
  return `
    <div class="trend-list">
      ${points
        .map((point) => `
          <div class="trend-row">
            <span class="muted">${escapeHtml(formatDate(point.bucketStart))}</span>
            <div class="trend-row-main">
              ${renderBar(point[key] || 0, max)}
              <strong>${escapeHtml(formatter(point[key] || 0))}</strong>
            </div>
          </div>`)
        .join('')}
    </div>`;
}

function renderVolumeChart(points) {
  if (!points?.length) {
    return '<div class="empty">No timeline data in this range.</div>';
  }

  const width = 960;
  const height = 260;
  const totals = points.map((point) => point.totalLogs || 0);
  const errors = points.map((point) => point.errorLogs || 0);
  const warns = points.map((point) => point.warnLogs || 0);
  const max = Math.max(...totals, ...errors, ...warns, 0);
  const totalPoints = normalizeChartPoints(totals, width, height, max);
  const errorPoints = normalizeChartPoints(errors, width, height, max);
  const warnPoints = normalizeChartPoints(warns, width, height, max);
  const totalPath = createSmoothPath(totalPoints);
  const errorPath = createSmoothPath(errorPoints);
  const warnPath = createSmoothPath(warnPoints);
  const totalArea = buildAreaPath(totalPoints, height);
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * (4 - index)));
  const labels = points.map((point, index) => {
    if (index !== 0 && index !== points.length - 1 && index % Math.ceil(points.length / 6) !== 0) return '';
    return `<span class="chart-x-label muted">${escapeHtml(chartLabel(point.bucketStart))}</span>`;
  }).join('');

  return `
    <div class="chart-shell interactive-chart">
      <div class="chart-body">
        <div class="chart-y-axis muted">
          ${ticks.map((tick) => `<span>${escapeHtml(formatCompactNumber(tick))}</span>`).join('')}
        </div>
        <div class="chart-canvas-wrap">
          <svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="log volume over time">
            <defs>
              <linearGradient id="analytics-total-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="rgba(168, 85, 247, 0.35)" />
                <stop offset="100%" stop-color="rgba(168, 85, 247, 0.02)" />
              </linearGradient>
            </defs>
            ${Array.from({ length: 5 }, (_, index) => {
              const y = (height / 4) * index;
              return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" class="chart-grid-line"></line>`;
            }).join('')}
            ${Array.from({ length: 7 }, (_, index) => {
              const x = (width / 6) * index;
              return `<line x1="${x}" y1="0" x2="${x}" y2="${height}" class="chart-grid-line chart-grid-line-vertical"></line>`;
            }).join('')}
            <path d="${totalArea}" fill="url(#analytics-total-gradient)"></path>
            <path d="${totalPath}" class="chart-line chart-line-total"></path>
            <path d="${warnPath}" class="chart-line chart-line-warn"></path>
            <path d="${errorPath}" class="chart-line chart-line-error"></path>
            <line x1="0" x2="0" y1="0" y2="${height}" class="chart-crosshair hidden"></line>
            <circle r="5" class="chart-active-dot chart-active-dot-total hidden"></circle>
            <circle r="5" class="chart-active-dot chart-active-dot-warn hidden"></circle>
            <circle r="5" class="chart-active-dot chart-active-dot-error hidden"></circle>
          </svg>
          <div class="chart-tooltip hidden"></div>
          <div class="chart-hover-overlay"></div>
        </div>
      </div>
      <div class="chart-x-axis">${labels}</div>
      <div class="chart-legend">
        <span class="chart-legend-item"><i class="legend-dot legend-dot-error"></i>Errors</span>
        <span class="chart-legend-item"><i class="legend-dot legend-dot-warn"></i>Warnings</span>
        <span class="chart-legend-item"><i class="legend-dot legend-dot-total"></i>Total</span>
      </div>
    </div>`;
}

function renderHeatmap(points) {
  if (!points?.length) {
    return '<div class="empty">No error events in this range.</div>';
  }

  const days = [...new Set(points.map((point) => point.day))].sort();
  const map = new Map(points.map((point) => [`${point.day}:${point.hour}`, point.errorCount]));
  const max = Math.max(...points.map((point) => point.errorCount || 0), 0);

  return `
    <div class="heatmap-wrapper">
      <div class="heatmap-grid">
        <div class="heatmap-corner"></div>
        ${Array.from({ length: 24 }, (_, hour) => `<div class="heatmap-hour muted">${hour}</div>`).join('')}
        ${days
          .map((day) => `
            <div class="heatmap-day muted">${escapeHtml(new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</div>
            ${Array.from({ length: 24 }, (_, hour) => {
              const count = map.get(`${day}:${hour}`) || 0;
              const alpha = max > 0 ? Math.max(0.08, count / max) : 0.08;
              return `<div class="heatmap-cell" title="${escapeHtml(`${day} ${String(hour).padStart(2, '0')}:00 • ${count} errors`)}" style="background: rgba(248, 113, 113, ${alpha});"></div>`;
            }).join('')}`)
          .join('')}
      </div>
      <div class="heatmap-scale muted">
        <span>Less</span>
        <div class="heatmap-scale-dots">
          <i class="heatmap-scale-dot" style="background: rgba(248, 113, 113, 0.12)"></i>
          <i class="heatmap-scale-dot" style="background: rgba(248, 113, 113, 0.32)"></i>
          <i class="heatmap-scale-dot" style="background: rgba(248, 113, 113, 0.56)"></i>
          <i class="heatmap-scale-dot" style="background: rgba(248, 113, 113, 0.9)"></i>
        </div>
        <span>More</span>
      </div>
    </div>`;
}

function renderTopErrors(items) {
  if (!items?.length) {
    return '<div class="empty">No repeated error messages in this range.</div>';
  }

  const max = Math.max(...items.map((item) => item.count || 0), 0);
  return `
    <div class="top-errors-list">
      ${items
        .map((item, index) => `
          <div class="top-error-row">
            <div class="top-error-header">
              <div class="top-error-rank">${index + 1}</div>
              <div>
                <button class="link-button top-error-link" data-analytics-error-message="${escapeHtml(item.message)}">${escapeHtml(item.message)}</button>
                <div class="muted top-error-meta">Last seen ${escapeHtml(formatDate(item.lastSeenAt))}</div>
              </div>
              <strong>${escapeHtml(formatCompactNumber(item.count))}</strong>
            </div>
            <div class="top-error-progress">
              ${renderBar(item.count || 0, max)}
            </div>
          </div>`)
        .join('')}
    </div>`;
}

function percentDelta(current, previous) {
  if (!previous) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function renderDeltaPill(current, previous) {
  const delta = percentDelta(current, previous);
  const cls = delta >= 0 ? 'delta-up' : 'delta-down';
  const sign = delta >= 0 ? '+' : '';
  return `<span class="delta-pill ${cls}">${sign}${formatNumber(delta, 1)}%</span>`;
}

function renderVolumeComparison(logs) {
  if (!logs?.comparison || !logs?.volumeComparison?.length) {
    return '<div class="empty">No comparison data in this range.</div>';
  }

  const max = Math.max(
    ...logs.volumeComparison.flatMap((point) => [point.currentTotalLogs || 0, point.previousTotalLogs || 0]),
    0,
  );

  return `
    <div class="comparison-grid">
      <div class="detail-grid">
        <div class="detail-card">
          <span class="muted">Current window logs</span>
          <strong>${escapeHtml(formatCompactNumber(logs.comparison.currentTotalLogs))}</strong>
          <div class="top-gap">${renderDeltaPill(logs.comparison.currentTotalLogs, logs.comparison.previousTotalLogs)} <span class="muted">vs previous window</span></div>
        </div>
        <div class="detail-card">
          <span class="muted">Current window errors</span>
          <strong>${escapeHtml(formatCompactNumber(logs.comparison.currentErrorLogs))}</strong>
          <div class="top-gap">${renderDeltaPill(logs.comparison.currentErrorLogs, logs.comparison.previousErrorLogs)} <span class="muted">vs previous window</span></div>
        </div>
      </div>
      <div class="comparison-columns top-gap">
        ${logs.volumeComparison
          .map((point) => `
            <div class="comparison-column" title="${escapeHtml(`${formatDate(point.bucketStart)} • current ${point.currentTotalLogs || 0}, previous ${point.previousTotalLogs || 0}`)}">
              <div class="comparison-column-bars">
                <div class="comparison-column-bar comparison-column-bar-previous" style="height:${max > 0 ? Math.max(6, ((point.previousTotalLogs || 0) / max) * 100) : 0}%"></div>
                <div class="comparison-column-bar comparison-column-bar-current" style="height:${max > 0 ? Math.max(6, ((point.currentTotalLogs || 0) / max) * 100) : 0}%"></div>
              </div>
              <span class="comparison-column-label muted">${escapeHtml(new Date(point.bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>
            </div>`)
          .join('')}
      </div>
      <div class="chart-legend">
        <span class="chart-legend-item"><i class="legend-dot legend-dot-previous"></i>Previous</span>
        <span class="chart-legend-item"><i class="legend-dot legend-dot-total"></i>Current</span>
      </div>
    </div>`;
}

function renderAnalytics() {
  const overview = state.analyticsOverview;
  const logs = state.analyticsLogs;
  const system = state.analyticsSystem;

  if (!overview || !logs || !system) {
    document.getElementById('analytics-kpis').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-overview-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-log-volume-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-heatmap-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-top-errors-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-comparison-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-cpu-memory-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-system-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    document.getElementById('analytics-hosts-output').innerHTML = '<div class="empty">Loading analytics…</div>';
    return;
  }

  document.getElementById('analytics-kpis').innerHTML = [
    ['Logs', formatCompactNumber(overview.totals.totalLogs)],
    ['Errors', formatCompactNumber(overview.totals.errorLogs)],
    ['Active agents', overview.totals.activeAgents],
    ['Avg CPU', formatPercent(overview.totals.avgCpuPercent)],
    ['Avg memory', formatPercent(overview.totals.avgMemoryUsedPercent)],
    ['Avg disk', formatPercent(overview.totals.avgDiskUsedPercent)],
  ]
    .map(([label, value]) => `<div class="kpi"><span class="muted">${label}</span><strong>${value}</strong></div>`)
    .join('');

  document.getElementById('analytics-overview-output').innerHTML = `
    <div class="detail-grid analytics-overview-grid">
      <div class="detail-card analytics-detail-card"><span class="muted">Window</span><strong>${escapeHtml(formatDate(overview.startAt))}</strong><div class="muted">to ${escapeHtml(formatDate(overview.endAt))}</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Matched agents</span><strong>${escapeHtml(String(overview.totals.matchedAgents))}</strong><div class="muted">Across ${escapeHtml(String(overview.totals.matchedHosts))} host(s)</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Heartbeat samples</span><strong>${escapeHtml(String(overview.totals.heartbeatSamples))}</strong><div class="muted">${escapeHtml(String(overview.totals.unhealthyHeartbeats))} unhealthy</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Warnings</span><strong>${escapeHtml(formatCompactNumber(overview.totals.warnLogs))}</strong><div class="muted">Generated ${escapeHtml(formatDate(overview.generatedAt))}</div></div>
    </div>`;

  document.getElementById('analytics-log-volume-output').innerHTML = renderVolumeChart(logs.volume);
  document.getElementById('analytics-heatmap-output').innerHTML = renderHeatmap(logs.errorHeatmap);
  document.getElementById('analytics-top-errors-output').innerHTML = renderTopErrors(logs.topErrorMessages);
  document.getElementById('analytics-comparison-output').innerHTML = renderVolumeComparison(logs);

  const analyticsAgentId = document.getElementById('analytics-agent-filter')?.value.trim();
  const analyticsHostId = document.getElementById('analytics-host-filter')?.value.trim();
  let cpuMemoryScope = 'Fleet average CPU and memory usage for matched agents.';
  if (analyticsAgentId) {
    cpuMemoryScope = `Selected agent: ${analyticsAgentId}`;
  } else if (analyticsHostId) {
    cpuMemoryScope = `Host average for ${analyticsHostId}`;
  }
  document.getElementById('analytics-cpu-memory-copy').textContent = cpuMemoryScope;
  document.getElementById('analytics-cpu-memory-output').innerHTML = renderDualMetricChart(
    system.timeline.map((point) => ({
      label: point.bucketStart,
      firstValue: point.avgCpuPercent,
      secondValue: point.avgMemoryUsedPercent,
    })),
    {
      title: 'Analytics CPU and memory trend',
      firstLabel: 'CPU',
      secondLabel: 'Memory',
      firstColor: '#38bdf8',
      secondColor: '#a855f7',
      gradientId: 'analytics-cpu-memory-gradient',
      maxValue: 100,
      valueFormatter: (value) => `${Math.round(value)}%`,
    },
  );

  document.getElementById('analytics-system-output').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card analytics-detail-card"><span class="muted">Avg CPU</span><strong>${escapeHtml(formatPercent(system.summary.avgCpuPercent))}</strong><div class="muted">Peak ${escapeHtml(formatPercent(system.summary.maxCpuPercent))}</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Avg memory</span><strong>${escapeHtml(formatPercent(system.summary.avgMemoryUsedPercent))}</strong><div class="muted">Peak ${escapeHtml(formatPercent(system.summary.maxMemoryUsedPercent))}</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Avg disk</span><strong>${escapeHtml(formatPercent(system.summary.avgDiskUsedPercent))}</strong><div class="muted">Peak ${escapeHtml(formatPercent(system.summary.maxDiskUsedPercent))}</div></div>
      <div class="detail-card analytics-detail-card"><span class="muted">Samples</span><strong>${escapeHtml(formatCompactNumber(system.summary.sampleCount))}</strong><div class="muted">${escapeHtml(String(system.summary.unhealthySamples))} unhealthy</div></div>
    </div>
    <div class="top-gap">
      <h4>CPU trend</h4>
      ${renderMiniTrend(system.timeline, 'avgCpuPercent', formatPercent)}
    </div>`;

  document.getElementById('analytics-hosts-output').innerHTML = renderHostDonut(logs, system);

  const chartWidth = 960;
  const chartHeight = 260;
  const chartTotals = logs.volume.map((point) => point.totalLogs || 0);
  const chartErrors = logs.volume.map((point) => point.errorLogs || 0);
  const chartWarns = logs.volume.map((point) => point.warnLogs || 0);
  const chartMax = Math.max(...chartTotals, ...chartErrors, ...chartWarns, 0);
  const totalChartPoints = normalizeChartPoints(chartTotals, chartWidth, chartHeight, chartMax);
  const errorChartPoints = normalizeChartPoints(chartErrors, chartWidth, chartHeight, chartMax);
  const warnChartPoints = normalizeChartPoints(chartWarns, chartWidth, chartHeight, chartMax);
  const interactivePoints = logs.volume.map((point, index) => ({
    ...point,
    x: totalChartPoints[index]?.x ?? 0,
    totalY: totalChartPoints[index]?.y ?? chartHeight,
    warnY: warnChartPoints[index]?.y ?? chartHeight,
    errorY: errorChartPoints[index]?.y ?? chartHeight,
  }));

  attachVolumeChartInteractions(interactivePoints);
  attachHostDonutInteractions();

  document.querySelectorAll('[data-analytics-level]').forEach((button) => {
    button.onclick = () => {
      document.getElementById('logs-level').value = button.dataset.analyticsLevel;
      setSection('logs');
      void runLogSearch(true);
    };
  });

  document.querySelectorAll('[data-analytics-host]').forEach((button) => {
    button.onclick = () => {
      const hostId = button.dataset.analyticsHost;
      document.getElementById('logs-host-id').value = hostId;
      document.getElementById('agent-search').value = hostId;
      document.getElementById('analytics-host-filter').value = hostId;
      setSection('logs');
      void runLogSearch(true);
    };
  });

  document.querySelectorAll('[data-analytics-error-message]').forEach((button) => {
    button.onclick = () => {
      document.getElementById('logs-query').value = button.dataset.analyticsErrorMessage;
      document.getElementById('logs-level').value = 'error';
      setSection('logs');
      void runLogSearch(true);
    };
  });
}

function renderEnrollmentTokens() {
  document.getElementById('enrollment-tokens-output').innerHTML = state.enrollmentTokens.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Prefix</th>
            <th>Expires</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.enrollmentTokens
            .map((token) => {
              const status = token.revokedAt ? 'revoked' : token.usedAt ? 'used' : 'active';
              return `
                <tr>
                  <td>${escapeHtml(token.label || '—')}</td>
                  <td><code>${escapeHtml(token.tokenPrefix || '—')}</code></td>
                  <td>${escapeHtml(formatDate(token.expiresAt))}</td>
                  <td>${escapeHtml(status)}</td>
                  <td>${status === 'active' ? `<button class="warn" data-revoke-enrollment-token="${token.id}">Revoke</button>` : ''}</td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No enrollment tokens found.</div>';

  document.querySelectorAll('[data-revoke-enrollment-token]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/enrollment-tokens/${button.dataset.revokeEnrollmentToken}/revoke`, { method: 'POST' });
      await refreshEnrollmentTokens();
    };
  });
}

function renderAlertIntegrations() {
  document.getElementById('alert-integrations-output').innerHTML = state.alertIntegrations.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Chat</th>
            <th>Token</th>
            <th>Verified</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.alertIntegrations
            .map((integration) => `
              <tr>
                <td><strong>${escapeHtml(integration.name)}</strong></td>
                <td><code>${escapeHtml(integration.chatId)}${integration.threadId ? ` / ${escapeHtml(integration.threadId)}` : ''}</code></td>
                <td>${escapeHtml(integration.tokenPreview)}</td>
                <td>${escapeHtml(formatDate(integration.lastVerifiedAt))}</td>
                <td>
                  <button data-test-alert-integration="${integration.id}">Send test</button>
                  <button data-toggle-alert-integration="${integration.id}">${integration.enabled ? 'Disable' : 'Enable'}</button>
                  <button class="warn" data-delete-alert-integration="${integration.id}">Delete</button>
                </td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No Telegram integrations configured yet.</div>';

  document.querySelectorAll('[data-test-alert-integration]').forEach((button) => {
    button.onclick = async () => {
      const result = await api(`/admin/alerts/telegram/integrations/${button.dataset.testAlertIntegration}/test`, {
        method: 'POST',
      });
      document.getElementById('alert-integration-feedback').textContent = result.description;
      await refreshAlertIntegrations();
    };
  });

  document.querySelectorAll('[data-toggle-alert-integration]').forEach((button) => {
    button.onclick = async () => {
      const integration = state.alertIntegrations.find((item) => item.id === button.dataset.toggleAlertIntegration);
      await api(`/admin/alerts/telegram/integrations/${button.dataset.toggleAlertIntegration}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !integration.enabled }),
      });
      await refreshAlertIntegrations();
    };
  });

  document.querySelectorAll('[data-delete-alert-integration]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('Delete this integration?')) return;
      try {
        await api(`/admin/alerts/telegram/integrations/${button.dataset.deleteAlertIntegration}`, {
          method: 'DELETE',
        });
        await refreshAlertIntegrations();
      } catch (error) {
        document.getElementById('alert-integration-feedback').textContent = error.message;
      }
    };
  });
}

function renderAlertRules() {
  document.getElementById('alert-rules-output').innerHTML = state.alertRules.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Source</th>
            <th>Severity</th>
            <th>Integration</th>
            <th>Updated</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.alertRules
            .map((rule) => `
              <tr>
                <td><strong>${escapeHtml(rule.name)}</strong><details><summary class="muted">dsl</summary><pre>${escapeHtml(rule.dslText)}</pre></details></td>
                <td>${escapeHtml(rule.source)}</td>
                <td>${escapeHtml(rule.severity)}</td>
                <td><code>${escapeHtml(rule.integrationId)}</code></td>
                <td>${escapeHtml(formatDate(rule.updatedAt))}</td>
                <td>
                  <button data-edit-alert-rule="${rule.id}">Load into editor</button>
                  <button data-toggle-alert-rule="${rule.id}">${rule.enabled ? 'Disable' : 'Enable'}</button>
                  <button class="warn" data-delete-alert-rule="${rule.id}">Delete</button>
                </td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No alert rules created yet.</div>';

  document.querySelectorAll('[data-edit-alert-rule]').forEach((button) => {
    button.onclick = () => {
      const rule = state.alertRules.find((item) => item.id === button.dataset.editAlertRule);
      if (rule) {
        document.getElementById('alert-dsl-input').value = rule.dslText;
        document.getElementById('create-alert-rule').dataset.ruleId = rule.id;
        document.getElementById('create-alert-rule').textContent = 'Save rule';
      }
    };
  });

  document.querySelectorAll('[data-toggle-alert-rule]').forEach((button) => {
    button.onclick = async () => {
      const rule = state.alertRules.find((item) => item.id === button.dataset.toggleAlertRule);
      const result = await api(`/admin/alerts/rules/${button.dataset.toggleAlertRule}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      document.getElementById('alert-dsl-feedback').textContent = result.explanation;
      await refreshAlertRules();
    };
  });

  document.querySelectorAll('[data-delete-alert-rule]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('Delete this rule?')) return;
      await api(`/admin/alerts/rules/${button.dataset.deleteAlertRule}`, {
        method: 'DELETE',
      });
      await refreshAlertRules();
    };
  });
}

function renderAlertDslMetadata() {
  if (!state.alertDslMetadata) {
    document.getElementById('alert-dsl-metadata').textContent = 'Loading metadata...';
    return;
  }

  const fields = state.alertDslMetadata.fields || {};
  document.getElementById('alert-dsl-metadata').innerHTML = `
    <div><strong>Sources:</strong> ${(state.alertDslMetadata.sources || []).join(', ')}</div>
    <div class="top-gap"><strong>Operators:</strong> ${(state.alertDslMetadata.operators || []).join(' ')}</div>
    <div class="top-gap"><strong>Logs fields:</strong> ${(fields.logs || []).join(', ')}</div>
    <div class="top-gap"><strong>Heartbeats fields:</strong> ${(fields.heartbeats || []).join(', ')}</div>
  `;
}

function renderAlertIncidents() {
  document.getElementById('alert-incidents-output').innerHTML = state.alertIncidents.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Status</th>
            <th>Message</th>
            <th>Seen</th>
            <th>Ack</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.alertIncidents
            .map((incident) => `
              <tr>
                <td><code>${escapeHtml(incident.subjectLabel)}</code></td>
                <td>${escapeHtml(incident.status)}</td>
                <td>${escapeHtml(incident.message)}</td>
                <td>${escapeHtml(formatDate(incident.lastSeenAt))}</td>
                <td>${escapeHtml(incident.acknowledgedAt ? `acked by ${incident.acknowledgedBy || 'operator'}` : '—')}</td>
                <td>
                  <button data-ack-incident="${incident.id}">Ack</button>
                  <button data-resolve-incident="${incident.id}">Resolve</button>
                  <button data-silence-incident="${incident.id}">Silence 60m</button>
                </td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No incidents yet.</div>';

  document.querySelectorAll('[data-resolve-incident]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/alerts/incidents/${button.dataset.resolveIncident}/resolve`, {
        method: 'POST',
      });
      await refreshAlertIncidents();
    };
  });

  document.querySelectorAll('[data-ack-incident]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/alerts/incidents/${button.dataset.ackIncident}/ack`, {
        method: 'POST',
        body: JSON.stringify({ acknowledgedBy: state.operator?.username || 'operator' }),
      });
      await refreshAlertIncidents();
    };
  });

  document.querySelectorAll('[data-silence-incident]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/alerts/incidents/${button.dataset.silenceIncident}/silence`, {
        method: 'POST',
        body: JSON.stringify({ durationMinutes: 60 }),
      });
      await Promise.all([refreshAlertIncidents(), refreshAlertSilences()]);
    };
  });
}

function renderAlertNotifications() {
  document.getElementById('alert-notifications-output').innerHTML = state.alertNotifications.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>State</th>
            <th>Incident</th>
            <th>Sent</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${state.alertNotifications
            .slice(0, 20)
            .map((row) => `
              <tr>
                <td>${escapeHtml(row.kind)}</td>
                <td>${escapeHtml(row.state)}</td>
                <td><code>${escapeHtml(row.incidentId)}</code></td>
                <td>${escapeHtml(formatDate(row.sentAt || row.createdAt))}</td>
                <td>${escapeHtml(row.lastError || '—')}</td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No notifications sent yet.</div>';
}

function renderAlertSilences() {
  document.getElementById('alert-silences-output').innerHTML = state.alertSilences.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Subject</th>
            <th>Reason</th>
            <th>Ends</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.alertSilences
            .map((silence) => `
              <tr>
                <td><code>${escapeHtml(silence.ruleId || 'all')}</code></td>
                <td>${escapeHtml([silence.subjectType, silence.subjectId].filter(Boolean).join(':') || 'all')}</td>
                <td>${escapeHtml(silence.reason || '—')}</td>
                <td>${escapeHtml(formatDate(silence.endsAt))}</td>
                <td><button class="warn" data-cancel-silence="${silence.id}">Cancel</button></td>
              </tr>`)
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No silences configured.</div>';

  document.querySelectorAll('[data-cancel-silence]').forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/alerts/silences/${button.dataset.cancelSilence}/cancel`, {
        method: 'POST',
      });
      await refreshAlertSilences();
    };
  });
}

function openDrawer() {
  document.getElementById('agent-drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
}

function closeDrawer() {
  document.getElementById('agent-drawer').classList.add('hidden');
  document.getElementById('drawer-backdrop').classList.add('hidden');
}

document.getElementById('login-button').onclick = async () => {
  loginError.textContent = '';
  try {
    await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    window.location.replace('/admin/');
  } catch (error) {
    loginError.textContent = error.message;
  }
};

document.getElementById('logout-button').onclick = async () => {
  await api('/auth/logout', { method: 'POST' });
  loginShell.classList.remove('hidden');
  appShell.classList.add('hidden');
};

document.querySelectorAll('.nav-item').forEach((button) => {
  button.onclick = () => setSection(button.dataset.section);
});

document.getElementById('refresh-button').onclick = async () => {
  if (state.activeSection === 'fleet') {
    await refreshAgents();
  } else if (state.activeSection === 'logs') {
    await runLogSearch(true);
  } else if (state.activeSection === 'analytics') {
    await refreshAnalytics();
  } else if (state.activeSection === 'alerts') {
    await Promise.all([
      refreshAlertIntegrations(),
      refreshAlertRules(),
      refreshAlertDslMetadata(),
      refreshAlertIncidents(),
      refreshAlertSilences(),
      refreshAlertNotifications(),
    ]);
  } else {
    await refreshEnrollmentTokens();
  }
};

document.getElementById('apply-agent-filters').onclick = async () => {
  await refreshAgents();
};

document.getElementById('search-logs').onclick = async () => {
  await runLogSearch(true);
};

document.getElementById('apply-analytics-filters').onclick = async () => {
  await refreshAnalytics();
};

document.getElementById('load-more-logs').onclick = async () => {
  await runLogSearch(false);
};

document.getElementById('create-token').onclick = async () => {
  const result = await api('/admin/enrollment-tokens', {
    method: 'POST',
    body: JSON.stringify({
      label: document.getElementById('token-label').value,
      ttlMinutes: Number(document.getElementById('token-ttl').value),
    }),
  });
  const output = document.getElementById('token-output');
  output.classList.remove('hidden');
  output.textContent = JSON.stringify(result, null, 2);
  await refreshEnrollmentTokens();
};

document.getElementById('create-alert-integration').onclick = async () => {
  try {
    const result = await api('/admin/alerts/telegram/integrations', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('alert-integration-name').value.trim(),
        botToken: document.getElementById('alert-bot-token').value.trim(),
        chatId: document.getElementById('alert-chat-id').value.trim(),
        threadId: document.getElementById('alert-thread-id').value.trim() || undefined,
      }),
    });
    document.getElementById('alert-integration-feedback').textContent = `Saved integration ${result.tokenPreview}`;
    await refreshAlertIntegrations();
  } catch (error) {
    document.getElementById('alert-integration-feedback').textContent = error.message;
  }
};

document.getElementById('validate-alert-dsl').onclick = async () => {
  try {
    const result = await api('/admin/alerts/parse', {
      method: 'POST',
      body: JSON.stringify({
        dslText: document.getElementById('alert-dsl-input').value,
      }),
    });
    document.getElementById('alert-dsl-feedback').textContent = result.ok
      ? result.explanation
      : result.errors?.map((error) => error.message).join('; ');
    document.getElementById('alert-dsl-preview').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    document.getElementById('alert-dsl-feedback').textContent = error.message;
  }
};

document.getElementById('preview-alert-dsl').onclick = async () => {
  try {
    const result = await api('/admin/alerts/preview', {
      method: 'POST',
      body: JSON.stringify({
        dslText: document.getElementById('alert-dsl-input').value,
      }),
    });
    document.getElementById('alert-dsl-feedback').textContent = `${result.explanation} Matches: ${result.count}`;
    document.getElementById('alert-dsl-preview').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    document.getElementById('alert-dsl-feedback').textContent = error.message;
  }
};

document.getElementById('create-alert-rule').onclick = async () => {
  try {
    const ruleId = document.getElementById('create-alert-rule').dataset.ruleId;
    const result = await api(ruleId ? `/admin/alerts/rules/${ruleId}` : '/admin/alerts/rules', {
      method: ruleId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        dslText: document.getElementById('alert-dsl-input').value,
      }),
    });
    document.getElementById('alert-dsl-feedback').textContent = result.explanation;
    document.getElementById('create-alert-rule').dataset.ruleId = '';
    document.getElementById('create-alert-rule').textContent = 'Create rule';
    await refreshAlertRules();
  } catch (error) {
    document.getElementById('alert-dsl-feedback').textContent = error.message;
  }
};

document.getElementById('create-alert-silence').onclick = async () => {
  try {
    const result = await api('/admin/alerts/silences', {
      method: 'POST',
      body: JSON.stringify({
        ruleId: document.getElementById('alert-silence-rule-id').value.trim() || undefined,
        subjectType: document.getElementById('alert-silence-subject-type').value.trim() || undefined,
        subjectId: document.getElementById('alert-silence-subject-id').value.trim() || undefined,
        reason: document.getElementById('alert-silence-reason').value.trim() || undefined,
        durationMinutes: Number(document.getElementById('alert-silence-duration').value),
      }),
    });
    document.getElementById('alert-silence-feedback').textContent = `Silenced until ${result.endsAt}`;
    await refreshAlertSilences();
  } catch (error) {
    document.getElementById('alert-silence-feedback').textContent = error.message;
  }
};

document.getElementById('load-alert-snippet-error').onclick = () => {
  const snippet = state.alertDslMetadata?.snippets?.[0]?.dsl;
  if (snippet) document.getElementById('alert-dsl-input').value = snippet;
};

document.getElementById('load-alert-snippet-heartbeat').onclick = () => {
  const snippet = state.alertDslMetadata?.snippets?.[1]?.dsl;
  if (snippet) document.getElementById('alert-dsl-input').value = snippet;
};

document.getElementById('close-drawer').onclick = closeDrawer;
document.getElementById('drawer-backdrop').onclick = closeDrawer;

void refreshSession();
