/** Throughput / fan-out knobs applied in the hub after transport emit. */
export interface PipelineConfig {
  keyColumn?: string | readonly string[];
  conflateEnabled?: boolean;
  conflateByKey?: string;
  throttleEnabled?: boolean;
  throttleMs?: number;
  thinDeltas?: boolean;
  wireFormat?: 'json' | 'columnar';
  snapshotChunkSize?: number;
  reconnect?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: 'full' | 'equal' | 'none';
    maxAttempts?: number;
  };
}
