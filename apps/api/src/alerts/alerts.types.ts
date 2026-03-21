export type AlertSource = 'logs' | 'heartbeats';

export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface AlertFilterClause {
  field: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains';
  value: string | number | string[];
}

export interface AlertTriggerCount {
  kind: 'count';
  operator: '>=' | '>' | '<=' | '<' | '=';
  threshold: number;
}

export interface AlertTriggerAggregate {
  kind: 'aggregate';
  function: 'avg' | 'max';
  field: 'value';
  operator: '>=' | '>' | '<=' | '<' | '=';
  threshold: number;
}

export interface AlertTriggerMissing {
  kind: 'missing';
  durationSeconds: number;
}

export type AlertTrigger =
  | AlertTriggerCount
  | AlertTriggerAggregate
  | AlertTriggerMissing;

export interface CompiledAlertRule {
  version: 'v1';
  name: string;
  source: AlertSource;
  where: AlertFilterClause[];
  windowSeconds?: number;
  groupBy?: 'hostId' | 'agentId' | 'sourceType' | 'level';
  trigger: AlertTrigger;
  forSeconds?: number;
  dedupSeconds?: number;
  severity: AlertSeverity;
  message: string;
  notify: {
    type: 'telegram';
    target: string;
  };
}

export interface AlertIncidentSubject {
  type: 'global' | 'agentId' | 'hostId' | 'sourceType' | 'level';
  id: string;
  label: string;
}

export interface AlertDslValidationResult {
  ok: boolean;
  compiledRule?: CompiledAlertRule;
  errors: Array<{
    message: string;
    line?: number;
    column?: number;
  }>;
  warnings: string[];
  explanation?: string;
}
