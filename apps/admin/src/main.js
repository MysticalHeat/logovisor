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
  activeSection: 'fleet',
};

const sectionCopy = {
  fleet: ['Fleet', 'Agent health, runtime tokens, and latest host metrics.'],
  logs: ['Logs', 'Search ingested log events with cursor-based pagination.'],
  alerts: ['Alerts', 'Telegram integrations, DSL rules, and validation hints.'],
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
    await refreshAll();
  } catch {
    loginShell.classList.remove('hidden');
    appShell.classList.add('hidden');
  }
}

async function refreshAll() {
  await Promise.all([
    refreshAgents(),
    refreshEnrollmentTokens(),
    refreshAlertIntegrations(),
    refreshAlertRules(),
    refreshAlertDslMetadata(),
    refreshAlertIncidents(),
    refreshAlertSilences(),
    refreshAlertNotifications(),
  ]);
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
