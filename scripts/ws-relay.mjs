/**
 * A WebSocket relay that can be cut on demand.
 *
 * Exists so a test can take the broker away from a running feed and give it
 * back, without touching the shared STOMP fixture that everything else is
 * using. Point an app at the relay instead of the broker, then:
 *
 *   GET /cut    sever every live connection and refuse new ones
 *   GET /heal   accept connections again
 *   GET /state  { severed, connections }
 *
 * `/cut` terminates rather than closes: a broker that goes away does not
 * usually get to send a close frame, and the reconnect path this is meant to
 * exercise is the one that starts from a socket dying, not from a polite
 * shutdown.
 */
import { createServer } from 'node:http';
// `ws` is CommonJS, so its apparent named ESM exports do not resolve. This is
// v7, where the default export IS the WebSocket class and the server is
// `WebSocket.Server` — `WebSocketServer` and the `isBinary` message argument
// both arrived in v8.
import WebSocket from 'ws';

const WebSocketServer = WebSocket.Server;

const PORT = Number(process.env.RELAY_PORT ?? 8099);
const UPSTREAM = process.env.RELAY_UPSTREAM ?? 'ws://localhost:8082';
/** STOMP subprotocol. Both ends must agree, and the relay has to answer the
 *  client's handshake before it has spoken to upstream — so it picks one and
 *  asks upstream for the same. */
const SUBPROTOCOL = 'v12.stomp';

let severed = false;
const live = new Set();

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/cut') {
    severed = true;
    for (const sock of [...live]) {
      try { sock.terminate(); } catch { /* already gone */ }
    }
    live.clear();
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"severed":true}');
    return;
  }
  if (path === '/heal') {
    severed = false;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"severed":false}');
    return;
  }
  if (path === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ severed, connections: live.size }));
    return;
  }
  res.writeHead(404).end('not found');
});

const wss = new WebSocketServer({
  server,
  // v7 hands an Array here, v8 a Set — accept either rather than pinning the
  // relay to whichever is installed today.
  handleProtocols: (protocols) => {
    const list = [...protocols];
    return list.includes(SUBPROTOCOL) ? SUBPROTOCOL : (list[0] ?? false);
  },
});

wss.on('connection', (client) => {
  if (severed) {
    try { client.terminate(); } catch { /* already gone */ }
    return;
  }
  const upstream = new WebSocket(UPSTREAM, [SUBPROTOCOL]);
  live.add(client);
  live.add(upstream);

  // The client can start sending before upstream is open — STOMP's CONNECT
  // frame goes out immediately.
  // `data` arrives as a String for text frames and a Buffer for binary, so
  // forwarding it as-is preserves the frame type without an explicit flag.
  const pending = [];
  upstream.on('open', () => {
    for (const data of pending.splice(0)) upstream.send(data);
  });
  client.on('message', (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else pending.push(data);
  });
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  const bye = () => {
    live.delete(client);
    live.delete(upstream);
    try { client.terminate(); } catch { /* already gone */ }
    try { upstream.terminate(); } catch { /* already gone */ }
  };
  for (const sock of [client, upstream]) {
    sock.on('close', bye);
    sock.on('error', bye);
  }
});

server.listen(PORT, () => {
  console.log(`[ws-relay] ws://localhost:${PORT} → ${UPSTREAM}  (/cut /heal /state)`);
});
