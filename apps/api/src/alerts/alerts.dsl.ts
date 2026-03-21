import {
  AlertDslValidationResult,
  AlertFilterClause,
  AlertSeverity,
  AlertSource,
  CompiledAlertRule,
} from './alerts.types';

const allowedFieldsBySource: Record<AlertSource, string[]> = {
  logs: ['hostId', 'agentId', 'sourceType', 'level', 'message'],
  heartbeats: [
    'hostId',
    'agentId',
    'health',
    'queueDepth',
    'cpuPercent',
    'memoryUsedPercent',
    'diskUsedPercent',
  ],
};

const durationPattern = /^(\d+)([smhd])$/;

export function parseAlertDsl(input: string): AlertDslValidationResult {
  try {
    const trimmed = input.trim();
    const ruleMatch = trimmed.match(/^rule\s+"([^"]+)"\s*\{([\s\S]*)\}$/);
    if (!ruleMatch) {
      return fail('DSL must match: rule "name" { ... }');
    }

    const [, name, body] = ruleMatch;
    const entries = new Map<string, string>();
    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^([a-z_]+)\s*=\s*(.+)$/);
      if (!match) {
        return fail('Expected key = value');
      }
      entries.set(match[1], match[2].trim());
    }

    const source = parseSource(entries.get('source'));
    if (!source) {
      return fail('source must be one of logs | heartbeats');
    }

    const where = parseWhere(entries.get('where') ?? '', source);
    if (where === null) {
      return fail(
        'invalid where clause or unsupported field for selected source',
      );
    }

    const trigger = parseTrigger(entries.get('trigger') ?? '', source);
    if (!trigger) {
      return fail('invalid trigger expression for selected source');
    }

    const severity = parseSeverity(entries.get('severity'));
    if (!severity) {
      return fail('severity must be one of info | warn | error | critical');
    }

    const message = parseStringLiteral(entries.get('message'));
    if (!message) {
      return fail('message must be a quoted string');
    }

    const notify = parseNotify(entries.get('notify'));
    if (!notify) {
      return fail('notify must match telegram("integration-name")');
    }

    const compiledRule: CompiledAlertRule = {
      version: 'v1',
      name,
      source,
      where,
      windowSeconds: parseOptionalDuration(entries.get('window')),
      groupBy: parseGroupBy(entries.get('group_by')),
      trigger,
      forSeconds: parseOptionalDuration(entries.get('for')),
      dedupSeconds: parseOptionalDuration(entries.get('dedup')),
      severity,
      message,
      notify,
    };

    if (source === 'heartbeats' && trigger.kind === 'missing') {
      compiledRule.windowSeconds = undefined;
    } else if (!compiledRule.windowSeconds) {
      return fail('window is required for logs rules');
    }

    return {
      ok: true,
      compiledRule,
      errors: [],
      warnings: [],
      explanation: buildExplanation(compiledRule),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to parse DSL');
  }
}

function parseSource(value?: string): AlertSource | null {
  return value === 'logs' || value === 'heartbeats' ? value : null;
}

function parseWhere(
  value: string,
  source: AlertSource,
): AlertFilterClause[] | null {
  if (value.trim().length === 0) {
    return [];
  }

  const parts = value.split(/\s+and\s+/);
  const clauses: AlertFilterClause[] = [];

  for (const part of parts) {
    const inMatch = part.match(/^([A-Za-z][A-Za-z0-9]*)\s+in\s+\[(.+)\]$/);
    if (inMatch) {
      const field = inMatch[1];
      if (!isFieldAllowed(field, source)) {
        return null;
      }

      const rawItems = inMatch[2]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(parseStringLiteral);

      if (rawItems.some((item) => item === null)) {
        return null;
      }

      clauses.push({ field, operator: 'in', value: rawItems as string[] });
      continue;
    }

    const containsMatch = part.match(
      /^([A-Za-z][A-Za-z0-9]*)\s+contains\s+(.+)$/,
    );
    if (containsMatch) {
      const field = containsMatch[1];
      const stringValue = parseStringLiteral(containsMatch[2]);
      if (!stringValue || !isFieldAllowed(field, source)) {
        return null;
      }

      clauses.push({ field, operator: 'contains', value: stringValue });
      continue;
    }

    const compareMatch = part.match(
      /^([A-Za-z][A-Za-z0-9]*)\s*(=|!=|>=|<=|>|<)\s*(.+)$/,
    );
    if (!compareMatch) {
      return null;
    }

    const [, field, operator, rawValue] = compareMatch;
    if (!isFieldAllowed(field, source)) {
      return null;
    }

    clauses.push({
      field,
      operator: operator as AlertFilterClause['operator'],
      value: parseScalar(rawValue),
    });
  }

  return clauses;
}

function isFieldAllowed(field: string, source: AlertSource): boolean {
  return allowedFieldsBySource[source].includes(field);
}

function parseScalar(value: string): string | number {
  const stringValue = parseStringLiteral(value);
  if (stringValue !== null) {
    return stringValue;
  }

  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? value : numberValue;
}

function parseTrigger(
  value: string,
  source: AlertSource,
): CompiledAlertRule['trigger'] | null {
  const countMatch = value.match(/^count\(\)\s*(>=|<=|=|>|<)\s*(\d+)$/);
  if (countMatch) {
    return {
      kind: 'count',
      operator: countMatch[1] as '>=' | '<=' | '=' | '>' | '<',
      threshold: Number(countMatch[2]),
    };
  }

  const missingMatch = value.match(/^missing\s+for\s+(\d+[smhd])$/);
  if (missingMatch) {
    return {
      kind: 'missing',
      durationSeconds: parseDuration(missingMatch[1]),
    };
  }

  return null;
}

function parseSeverity(value?: string): AlertSeverity | null {
  const raw = parseStringLiteral(value) ?? value;
  return raw === 'info' ||
    raw === 'warn' ||
    raw === 'error' ||
    raw === 'critical'
    ? raw
    : null;
}

function parseStringLiteral(value?: string): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^"([\s\S]*)"$/);
  return match ? match[1] : null;
}

function parseNotify(value?: string): CompiledAlertRule['notify'] | null {
  const match = value?.match(/^telegram\("([^"]+)"\)$/);
  return match ? { type: 'telegram', target: match[1] } : null;
}

function parseGroupBy(
  value?: string,
): CompiledAlertRule['groupBy'] | undefined {
  return value === 'hostId' ||
    value === 'agentId' ||
    value === 'sourceType' ||
    value === 'level'
    ? value
    : undefined;
}

function parseOptionalDuration(value?: string): number | undefined {
  return value ? parseDuration(value) : undefined;
}

function parseDuration(value: string): number {
  const match = value.match(durationPattern);
  if (!match) {
    throw new Error(`invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      throw new Error(`invalid duration unit: ${match[2]}`);
  }
}

function buildExplanation(rule: CompiledAlertRule): string {
  const where = rule.where.length
    ? ` where ${rule.where
        .map(
          (clause) =>
            `${clause.field} ${clause.operator} ${renderValue(clause.value)}`,
        )
        .join(' and ')}`
    : '';
  const window = rule.windowSeconds
    ? ` within ${rule.windowSeconds} seconds`
    : '';

  if (rule.trigger.kind === 'missing') {
    return `Alert when ${rule.source}${where} is missing for ${rule.trigger.durationSeconds} seconds and notify telegram target ${rule.notify.target}.`;
  }

  return `Alert when ${rule.source}${where}${window} satisfies ${renderTrigger(rule.trigger)} and notify telegram target ${rule.notify.target}.`;
}

function renderTrigger(trigger: CompiledAlertRule['trigger']): string {
  if (trigger.kind === 'count') {
    return `count() ${trigger.operator} ${trigger.threshold}`;
  }

  if (trigger.kind === 'aggregate') {
    return `${trigger.function}(value) ${trigger.operator} ${trigger.threshold}`;
  }

  return `missing for ${trigger.durationSeconds} seconds`;
}

function renderValue(value: string | number | string[]): string {
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
}

function fail(message: string): AlertDslValidationResult {
  return {
    ok: false,
    errors: [{ message }],
    warnings: [],
  };
}
