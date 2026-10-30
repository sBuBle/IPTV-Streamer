import type { CheckKind, StreamCheck } from "../domain/types.js";

export interface LatestChecks {
  probe?: StreamCheck;
  playback?: StreamCheck;
}

export interface Store {
  init(): Promise<void>;
  recordCheck(check: StreamCheck): Promise<void>;
  /** Latest probe and playback check for every item that has any. */
  latestChecks(): Promise<Map<string, LatestChecks>>;
  history(itemId: string, kind: CheckKind, limit: number): Promise<StreamCheck[]>;
  /** Deletes checks older than the cutoff, keeping the latest of each kind per item. */
  prune(olderThan: number): Promise<number>;
  close?(): Promise<void>;
}
