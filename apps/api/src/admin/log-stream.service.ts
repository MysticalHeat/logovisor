import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface StreamedLogEvent {
  timestamp: string;
  observedAt: string;
  eventId: string;
  agentId: string;
  hostId: string;
  sourceType: string;
  level?: string;
  message: string;
  source: Record<string, unknown>;
}

export interface LogStreamFilters {
  agentId?: string;
  hostId?: string;
  sourceType?: string;
  level?: string;
  query?: string;
}

@Injectable()
export class LogStreamService {
  private readonly stream = new Subject<StreamedLogEvent>();

  get events$(): Subject<StreamedLogEvent> {
    return this.stream;
  }

  publishBatch(events: Record<string, unknown>[]): void {
    for (const event of events) {
      this.stream.next({
        timestamp: toStringValue(event.timestamp),
        observedAt: toStringValue(event.observed_at),
        eventId: toStringValue(event.event_id),
        agentId: toStringValue(event.agentId ?? event.agent_id),
        hostId: toStringValue(event.host_id),
        sourceType: toStringValue(event.source_type),
        level: toOptionalString(event.level),
        message: toStringValue(event.message),
        source: toRecord(event.source),
      });
    }
  }

  matchesFilters(event: StreamedLogEvent, filters: LogStreamFilters): boolean {
    if (filters.agentId && event.agentId !== filters.agentId) {
      return false;
    }
    if (filters.hostId && event.hostId !== filters.hostId) {
      return false;
    }
    if (filters.sourceType && event.sourceType !== filters.sourceType) {
      return false;
    }
    if (filters.level && (event.level ?? '') !== filters.level) {
      return false;
    }
    if (filters.query) {
      const query = filters.query.toLowerCase();
      const haystack = [event.message, event.hostId, event.agentId, event.sourceType, event.level ?? '']
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }

    return true;
  }
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
