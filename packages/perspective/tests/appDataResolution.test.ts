import { describe, it, expect } from 'vitest';
import { dataProviderConfigToPerspective } from '../src/mapFromDataProvider';
import { resolveProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
import type { DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';

/**
 * `{{name.key}}` substitution on the SSRM path.
 *
 * CSRM has always resolved AppData tokens before connecting; the Perspective
 * controller did not, so a catalog entry authored once and templated per user
 * worked on a client-side grid and was sent to the broker LITERALLY on a
 * server-side one — subscribing to a topic with braces in it.
 *
 * The controller resolves the whole config before mapping, so this covers the
 * mapping half: tokens anywhere in the STOMP bag survive into the Perspective
 * config, and identity does not depend on the lookup.
 */

const lookup = (name: string, key: string): unknown =>
  ({ session: { trader: 'TRADER007', desk: 'FX' } } as Record<string, Record<string, unknown>>)[name]?.[key];

const templated: DataProviderConfig = {
  providerId: 'p1',
  name: 'Positions',
  type: 'stomp',
  config: {
    feed: 'stomp',
    websocketUrl: 'ws://localhost:8082',
    listenerTopic: '/snapshot/positions/{{session.trader}}',
    requestMessage: '/app/positions/{{session.trader}}/{{session.desk}}',
    clientId: '{{session.trader}}',
    keyColumn: 'positionId',
    columnDefinitions: [
      { field: 'desk', headerName: '{{session.desk}} desk', cellDataType: 'text' },
    ],
  },
} as unknown as DataProviderConfig;

describe('AppData tokens resolve before the Perspective mapping', () => {
  it('substitutes into every templated STOMP field', () => {
    const out = dataProviderConfigToPerspective(resolveProviderConfig(templated, lookup));
    expect(out.snapshotTopic).toBe('/snapshot/positions/TRADER007');
    expect(out.triggerTopic).toBe('/app/positions/TRADER007/FX');
    expect(out.clientId).toBe('TRADER007');
  });

  it('reaches column definitions too, not just connection fields', () => {
    const resolved = resolveProviderConfig(templated, lookup);
    const cols = (resolved.config as { columnDefinitions: { headerName: string }[] }).columnDefinitions;
    expect(cols[0]!.headerName).toBe('FX desk');
  });

  it('sends the config through unchanged when nothing is templated', () => {
    const plain = {
      ...templated,
      config: { ...templated.config, listenerTopic: '/snapshot/positions/TRADER001', clientId: 'TRADER001' },
    } as DataProviderConfig;
    expect(dataProviderConfigToPerspective(resolveProviderConfig(plain, lookup)).snapshotTopic)
      .toBe('/snapshot/positions/TRADER001');
  });

  it('leaves an unresolvable token verbatim rather than emitting "undefined"', () => {
    const out = dataProviderConfigToPerspective(
      resolveProviderConfig(templated, () => undefined),
    );
    expect(out.snapshotTopic).toBe('/snapshot/positions/{{session.trader}}');
  });

  it('never rewrites identity', () => {
    expect(resolveProviderConfig(templated, lookup).providerId).toBe('p1');
  });
});
