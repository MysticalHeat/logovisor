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
  activeSection: 'fleet',
};

const sectionCopy = {
  fleet: ['Fleet', 'Agent health, runtime tokens, and latest host metrics.'],
  logs: ['Logs', 'Search ingested log events with cursor-based pagination.'],
  tokens: ['Tokens', 'Create, inspect, and revoke enrollment bootstrap tokens.'],
};

const loginShell = document.getElementById('login-shell');
const appShell = document.getElementById('app-shell');
const loginError = document.getElementById('login-error');

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
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
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
    await refreshAll();
  } catch {
    loginShell.classList.remove('hidden');
    appShell.classList.add('hidden');
  }
}

async function refreshAll() {
  await Promise.all([refreshAgents(), refreshEnrollmentTokens()]);
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

  renderFleet();
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
          ${(detail.recentHeartbeats || [])
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
    await refreshSession();
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

document.getElementById('close-drawer').onclick = closeDrawer;
document.getElementById('drawer-backdrop').onclick = closeDrawer;

void refreshSession();
