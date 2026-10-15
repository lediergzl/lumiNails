import type { SyncOperation, SyncQueueItem } from "./types";

export interface QueueInsert {
  operation: SyncOperation;
  entityId: string;
  payload: unknown;
  idempotencyKey: string;
}

export function createQueueItem(input: QueueInsert, now = new Date()): SyncQueueItem {
  const createdAt = now.toISOString();
  return {
    id: createId(),
    operation: input.operation,
    entity: "appointment",
    entityId: input.entityId,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    createdAt,
    retries: 0,
    nextRetryAt: null,
    status: "pending",
    lastError: null
  };
}

export function retryDelayMs(retries: number): number {
  const boundedAttempt = Math.max(0, Math.min(retries, 10));
  return Math.min(60_000, 1_000 * 2 ** boundedAttempt);
}

export function retryAt(retries: number, now = new Date()): string {
  return new Date(now.getTime() + retryDelayMs(retries)).toISOString();
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `luni-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
