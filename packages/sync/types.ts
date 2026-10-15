export type SyncStatus = "pending" | "syncing" | "failed" | "conflict" | "done";

export type SyncOperation =
  | "CREATE_APPOINTMENT"
  | "CANCEL_APPOINTMENT"
  | "RESCHEDULE_APPOINTMENT";

export interface SyncQueueItem {
  id: string;
  operation: SyncOperation;
  entity: "appointment";
  entityId: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
  retries: number;
  nextRetryAt: string | null;
  status: SyncStatus;
  lastError: string | null;
}

export interface SyncState {
  scope: string;
  lastServerCursor: string | null;
  lastSuccessfulSyncAt: string | null;
}
