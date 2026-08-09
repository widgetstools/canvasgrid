import type { ProviderEmit, TransportContext, TransportFactory, TransportHandle } from '../types';

function stub(name: string): TransportFactory {
  return (_cfg, emit: ProviderEmit, _ctx: TransportContext): TransportHandle => {
    emit({ status: 'error', error: `${name} transport is not implemented yet` });
    return {
      stop() { emit({ status: 'disconnected' }); },
      restart() { emit({ status: 'error', error: `${name} transport is not implemented yet` }); },
    };
  };
}

export const createSolaceTransport = stub('solace');
export const createAmpsTransport = stub('amps');
export const createSocketIoTransport = stub('socketio');
export const createWebSocketTransport = stub('websocket');
