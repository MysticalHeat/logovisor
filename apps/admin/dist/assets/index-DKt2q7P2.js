(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))l(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&l(o)}).observe(document,{childList:!0,subtree:!0});function s(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function l(a){if(a.ep)return;a.ep=!0;const r=s(a);fetch(a.href,r)}})();const n={operator:null,agents:[],agentDetails:new Map,selectedAgentId:null,agentTokens:[],enrollmentTokens:[],logs:[],logsCursor:null,activeSection:"fleet"},E={fleet:["Fleet","Agent health, runtime tokens, and latest host metrics."],logs:["Logs","Search ingested log events with cursor-based pagination."],tokens:["Tokens","Create, inspect, and revoke enrollment bootstrap tokens."]},f=document.getElementById("login-shell"),p=document.getElementById("app-shell"),B=document.getElementById("login-error");function m(e){return typeof e!="number"||Number.isNaN(e)?"n/a":`${(e/1024**3).toFixed(1)} GiB`}function u(e,t=2){return typeof e!="number"||Number.isNaN(e)?"n/a":e.toFixed(t)}function g(e){if(!e)return"n/a";const t=new Date(e);return Number.isNaN(t.getTime())?e:t.toLocaleString()}function d(e){return String(e).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function v(e){return e?[`CPU ${u(e.cpuPercent,1)}%`,`Load ${u(e.load1)}/${u(e.load5)}/${u(e.load15)}`,`Mem ${m(e.memoryUsedBytes)} / ${m(e.memoryTotalBytes)}`,`Swap ${m(e.swapUsedBytes)} / ${m(e.swapTotalBytes)}`,`Disk ${m(e.diskUsedBytes)} / ${m(e.diskTotalBytes)}`,`Net RX ${m(e.networkRxBytes)} | TX ${m(e.networkTxBytes)}`,`Uptime ${u(e.uptimeSeconds,0)}s`].join(`
`):'<span class="muted">No metrics yet</span>'}function w(e){const t=e.filter(s=>typeof s=="number"&&Number.isFinite(s));return t.length===0?0:t.reduce((s,l)=>s+l,0)/t.length}async function c(e,t={}){const s=await fetch(`/api${e}`,{credentials:"include",headers:{"Content-Type":"application/json",...t.headers||{}},...t});if(!s.ok)throw new Error(await s.text());return s.json()}function L(e){n.activeSection=e,document.querySelectorAll(".nav-item").forEach(t=>{t.classList.toggle("active",t.dataset.section===e)}),document.querySelectorAll(".section").forEach(t=>{t.classList.toggle("active",t.id===`section-${e}`)}),document.getElementById("section-title").textContent=E[e][0],document.getElementById("section-subtitle").textContent=E[e][1]}async function S(){try{const e=await c("/auth/me");n.operator=e,document.getElementById("operator-label").textContent=`signed in as ${e.username}`,f.classList.add("hidden"),p.classList.remove("hidden"),await N()}catch{f.classList.remove("hidden"),p.classList.add("hidden")}}async function N(){await Promise.all([I(),y()])}function C(){const e=document.getElementById("agent-search").value.trim(),t=document.getElementById("agent-status-filter").value,s=new URLSearchParams;return e&&s.set("search",e),t&&s.set("status",t),s.set("limit","50"),s.toString()}async function I(){var l;const e=C(),t=await c(`/admin/agents${e?`?${e}`:""}`);n.agents=t.items||[],n.agentDetails.clear();const s=await Promise.all(n.agents.map(a=>c(`/admin/agents/${a.id}`)));s.forEach(a=>n.agentDetails.set(a.id,a)),(!n.selectedAgentId||!n.agentDetails.has(n.selectedAgentId))&&(n.selectedAgentId=((l=s[0])==null?void 0:l.id)??null),n.selectedAgentId&&await k(n.selectedAgentId),P()}async function k(e){n.agentTokens=(await c(`/admin/agents/${e}/tokens`)).items||[],$()}async function y(){n.enrollmentTokens=(await c("/admin/enrollment-tokens")).items||[],D()}function P(){const e=n.agents.length,t=n.agents.filter(o=>o.status==="online").length,s=e-t,l=w(Array.from(n.agentDetails.values()).map(o=>{var i,h;return(h=(i=o.latestHeartbeat)==null?void 0:i.system)==null?void 0:h.cpuPercent})),a=w(Array.from(n.agentDetails.values()).map(o=>{var h;const i=(h=o.latestHeartbeat)==null?void 0:h.system;return!i||!i.memoryTotalBytes?null:i.memoryUsedBytes/i.memoryTotalBytes*100}));document.getElementById("fleet-kpis").innerHTML=[["Agents",e],["Online",t],["Offline",s],["Avg CPU",`${u(l,1)}%`],["Avg Mem",`${u(a,1)}%`]].map(([o,i])=>`<div class="kpi"><span class="muted">${o}</span><strong>${i}</strong></div>`).join("");const r=Array.from(n.agentDetails.values());document.getElementById("agents-output").innerHTML=r.length?`
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
          ${r.map(o=>{var i;return`
              <tr>
                <td><button class="agent-select" data-agent-id="${o.id}"><code>${d(o.hostId)}</code></button></td>
                <td class="${o.status==="online"?"status-online":"status-offline"}">${o.status}</td>
                <td>${d(o.hostname)}</td>
                <td>${d(o.os)}</td>
                <td>${d(g(o.lastSeenAt))}</td>
                <td class="metrics">${v((i=o.latestHeartbeat)==null?void 0:i.system)}</td>
              </tr>`}).join("")}
        </tbody>
      </table>`:'<div class="empty">No agents found.</div>',document.querySelectorAll("[data-agent-id]").forEach(o=>{o.onclick=async()=>{n.selectedAgentId=o.dataset.agentId,await k(n.selectedAgentId),A(),O()}}),A()}function A(){var t;const e=n.agentDetails.get(n.selectedAgentId);if(!e){document.getElementById("agent-detail").innerHTML='<div class="empty">Select an agent to inspect details.</div>',$();return}document.getElementById("drawer-title").textContent=`${e.hostId} details`,document.getElementById("drawer-subtitle").textContent=`${e.hostname} · ${e.os}`,document.getElementById("agent-detail").innerHTML=`
    <div class="detail-grid">
      <div class="detail-card"><span class="muted">Agent ID</span><code>${d(e.id)}</code></div>
      <div class="detail-card"><span class="muted">Installation ID</span><code>${d(e.installationId)}</code></div>
      <div class="detail-card"><span class="muted">Last seen</span><strong>${d(g(e.lastSeenAt))}</strong></div>
      <div class="detail-card"><span class="muted">Status</span><strong class="${e.status==="online"?"status-online":"status-offline"}">${e.status}</strong></div>
    </div>
    <div class="panel top-gap">
      <h3>Latest heartbeat snapshot</h3>
      <pre class="metrics">${d(v((t=e.latestHeartbeat)==null?void 0:t.system).replace(/<[^>]+>/g,""))}</pre>
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
          ${(e.recentHeartbeats||[]).map(s=>`
              <tr>
                <td>${d(g(s.receivedAt))}</td>
                <td>${d(s.health)}</td>
                <td>${d(String(s.queueDepth))}</td>
                <td class="metrics">${v(s.system)}</td>
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`,$()}function $(){if(!n.selectedAgentId){document.getElementById("agent-tokens").innerHTML='<div class="empty">Select an agent to inspect runtime tokens.</div>';return}document.getElementById("agent-tokens").innerHTML=n.agentTokens.length?`
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
          ${n.agentTokens.map(e=>`
              <tr>
                <td><code>${d(e.tokenPrefix)}</code></td>
                <td>${d(g(e.createdAt))}</td>
                <td>${e.revokedAt?d(g(e.revokedAt)):'<span class="muted">active</span>'}</td>
                <td>${e.revokedAt?"":`<button class="warn" data-revoke-agent-token="${e.id}">Revoke</button>`}</td>
              </tr>`).join("")}
        </tbody>
      </table>`:'<div class="empty">No runtime tokens found.</div>',document.querySelectorAll("[data-revoke-agent-token]").forEach(e=>{e.onclick=async()=>{await c(`/admin/agents/${n.selectedAgentId}/tokens/${e.dataset.revokeAgentToken}/revoke`,{method:"POST"}),await k(n.selectedAgentId)}})}async function b(e=!0){e&&(n.logsCursor=null);const t=new URLSearchParams;[["query",document.getElementById("logs-query").value.trim()],["hostId",document.getElementById("logs-host-id").value.trim()],["agentId",document.getElementById("logs-agent-id").value.trim()],["sourceType",document.getElementById("logs-source-type").value],["from",document.getElementById("logs-from").value.trim()],["to",document.getElementById("logs-to").value.trim()]].forEach(([a,r])=>{r&&t.set(a,r)}),t.set("limit","50"),n.logsCursor&&(t.set("beforeTimestamp",n.logsCursor.beforeTimestamp),t.set("beforeEventId",n.logsCursor.beforeEventId));const l=await c(`/admin/logs/search?${t.toString()}`);n.logs=e?l.items:[...n.logs,...l.items],n.logsCursor=l.nextCursor||null,x()}function x(){document.getElementById("logs-output").innerHTML=n.logs.length?`
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
          ${n.logs.map(e=>`
              <tr>
                <td>${d(g(e.timestamp))}</td>
                <td><code>${d(e.hostId)}</code></td>
                <td>${d(e.sourceType)}</td>
                <td>
                  <div>${d(e.message)}</div>
                  <details>
                    <summary class="muted">event details</summary>
                    <pre>${d(JSON.stringify(e,null,2))}</pre>
                  </details>
                </td>
              </tr>`).join("")}
        </tbody>
      </table>`:'<div class="empty">No log events loaded yet.</div>',document.getElementById("load-more-logs").classList.toggle("hidden",!n.logsCursor)}function D(){document.getElementById("enrollment-tokens-output").innerHTML=n.enrollmentTokens.length?`
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
          ${n.enrollmentTokens.map(e=>{const t=e.revokedAt?"revoked":e.usedAt?"used":"active";return`
                <tr>
                  <td>${d(e.label||"—")}</td>
                  <td><code>${d(e.tokenPrefix||"—")}</code></td>
                  <td>${d(g(e.expiresAt))}</td>
                  <td>${d(t)}</td>
                  <td>${t==="active"?`<button class="warn" data-revoke-enrollment-token="${e.id}">Revoke</button>`:""}</td>
                </tr>`}).join("")}
        </tbody>
      </table>`:'<div class="empty">No enrollment tokens found.</div>',document.querySelectorAll("[data-revoke-enrollment-token]").forEach(e=>{e.onclick=async()=>{await c(`/admin/enrollment-tokens/${e.dataset.revokeEnrollmentToken}/revoke`,{method:"POST"}),await y()}})}function O(){document.getElementById("agent-drawer").classList.remove("hidden"),document.getElementById("drawer-backdrop").classList.remove("hidden")}function T(){document.getElementById("agent-drawer").classList.add("hidden"),document.getElementById("drawer-backdrop").classList.add("hidden")}document.getElementById("login-button").onclick=async()=>{B.textContent="";try{await c("/auth/login",{method:"POST",body:JSON.stringify({username:document.getElementById("username").value,password:document.getElementById("password").value})}),await S()}catch(e){B.textContent=e.message}};document.getElementById("logout-button").onclick=async()=>{await c("/auth/logout",{method:"POST"}),f.classList.remove("hidden"),p.classList.add("hidden")};document.querySelectorAll(".nav-item").forEach(e=>{e.onclick=()=>L(e.dataset.section)});document.getElementById("refresh-button").onclick=async()=>{n.activeSection==="fleet"?await I():n.activeSection==="logs"?await b(!0):await y()};document.getElementById("apply-agent-filters").onclick=async()=>{await I()};document.getElementById("search-logs").onclick=async()=>{await b(!0)};document.getElementById("load-more-logs").onclick=async()=>{await b(!1)};document.getElementById("create-token").onclick=async()=>{const e=await c("/admin/enrollment-tokens",{method:"POST",body:JSON.stringify({label:document.getElementById("token-label").value,ttlMinutes:Number(document.getElementById("token-ttl").value)})}),t=document.getElementById("token-output");t.classList.remove("hidden"),t.textContent=JSON.stringify(e,null,2),await y()};document.getElementById("close-drawer").onclick=T;document.getElementById("drawer-backdrop").onclick=T;S();
