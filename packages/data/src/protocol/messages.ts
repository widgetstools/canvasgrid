import type { ColumnDefinition, FieldInfo } from '../types/schema';
import type { DataProviderConfig, ProviderStatus } from '../types/transport';
import type { ProviderStats } from '../types/stats';

export const PROTOCOL_VERSION = 1 as const;

/** Client → hub */
export type HubRequest =
  | { v: 1; id: string; type: 'ping' }
  | { v: 1; id: string; type: 'ensure'; config: DataProviderConfig }
  | { v: 1; id: string; type: 'attach'; providerId: string; subId: string }
  | { v: 1; id: string; type: 'detach'; providerId: string; subId: string }
  | { v: 1; id: string; type: 'start'; providerId: string }
  | { v: 1; id: string; type: 'stop'; providerId: string }
  | { v: 1; id: string; type: 'restart'; providerId: string; overlay?: Record<string, unknown> }
  | { v: 1; id: string; type: 'refresh'; providerId: string; subId: string }
  | { v: 1; id: string; type: 'getSnapshot'; providerId: string }
  | { v: 1; id: string; type: 'getMeta'; providerId: string }
  | { v: 1; id: string; type: 'getStats'; providerId: string };

/** Hub → client */
export type HubResponse =
  | { v: 1; id: string; type: 'pong' }
  | { v: 1; id: string; type: 'ok'; payload?: unknown }
  | { v: 1; id: string; type: 'error'; error: string }
  | { v: 1; id: string; type: 'snapshot'; rows: unknown[]; status: ProviderStatus }
  | {
      v: 1;
      id: string;
      type: 'meta';
      status: ProviderStatus;
      rowCount: number;
      columnDefinitions: ColumnDefinition[];
      inferredFields: FieldInfo[];
    }
  | { v: 1; id: string; type: 'stats'; stats: ProviderStats };

/** Unsolicited hub → client push */
export type HubPush =
  | {
      v: 1;
      type: 'push';
      providerId: string;
      subId?: string;
      /** Row objects, or a columnar batch when wireFormat='columnar'. */
      rows: unknown[] | { format: 'columnar'; fields: string[]; columns: unknown[][]; length: number };
      replace?: boolean;
      /**
       * NEW (v1 additive): replace-sequence chunk ordinal. A snapshot larger
       * than `snapshotChunkSize` fans out as multiple `replace: true` pushes —
       * `seq === 0` (or undefined) is the sequence head (client resets its
       * cache), `seq > 0` is a continuation chunk (client APPENDS it to the
       * replace in progress instead of treating it as a live tick).
       */
      seq?: number;
      /** NEW (v1 additive): true on the final chunk of a replace sequence. */
      final?: boolean;
      /** NEW (v1 additive): row ids removed upstream (transport-reported). */
      removes?: string[];
    }
  | { v: 1; type: 'status'; providerId: string; status: ProviderStatus; error?: string }
  | { v: 1; type: 'rowsReceived'; providerId: string; count: number };

export type HubMessage = HubRequest | HubResponse | HubPush;

export function isHubPush(msg: HubMessage): msg is HubPush {
  return msg.type === 'push'
    || msg.type === 'status'
    || msg.type === 'rowsReceived';
}
