import { parseAlertDsl } from './alerts.dsl';

describe('parseAlertDsl', () => {
  it('parses a log rule', () => {
    const result = parseAlertDsl(`rule "error_spike" {
  source = logs
  where = level in ["error", "warn"] and hostId = "hackathon2"
  window = 5m
  group_by = hostId
  trigger = count() >= 10
  for = 2m
  dedup = 15m
  severity = "error"
  message = "Errors on {{hostId}}: {{value}} in 5m"
  notify = telegram("ops-main")
}`);

    expect(result.ok).toBe(true);
    expect(result.compiledRule).toBeDefined();
    expect(result.compiledRule?.source).toBe('logs');
    expect(result.compiledRule?.trigger.kind).toBe('count');
    expect(result.compiledRule?.windowSeconds).toBe(300);
  });

  it('parses a heartbeat missing rule', () => {
    const result = parseAlertDsl(`rule "agent_offline" {
  source = heartbeats
  where = hostId = "hackathon2"
  trigger = missing for 2m
  severity = "critical"
  message = "No heartbeat from {{hostId}}"
  notify = telegram("ops-main")
}`);

    expect(result.ok).toBe(true);
    expect(result.compiledRule?.source).toBe('heartbeats');
    expect(result.compiledRule?.trigger.kind).toBe('missing');
  });

  it('parses a heartbeat unhealthy count rule', () => {
    const result = parseAlertDsl(`rule "agent_unhealthy" {
  source = heartbeats
  where = health = "degraded"
  window = 5m
  group_by = agentId
  trigger = count() >= 1
  severity = "warn"
  message = "Agent unhealthy: {{agentId}}"
  notify = telegram("ops-main")
}`);

    expect(result.ok).toBe(true);
    expect(result.compiledRule?.source).toBe('heartbeats');
    expect(result.compiledRule?.trigger.kind).toBe('count');
    expect(result.compiledRule?.windowSeconds).toBe(300);
  });

  it('rejects metrics source in MVP runtime', () => {
    const result = parseAlertDsl(`rule "high_cpu" {
  source = metrics
  where = hostId = "hackathon2"
  window = 5m
  trigger = count() >= 1
  severity = "warn"
  message = "High cpu"
  notify = telegram("ops-main")
}`);

    expect(result.ok).toBe(false);
  });
});
