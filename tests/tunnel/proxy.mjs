/**
 * A tunnel, as the strictest of them treat a request (`docs/HOSTING.md`): it answers at a public hostname and
 * connects to the server on this machine, rewriting `Host` to the server's own address and saying the page's
 * host in `X-Forwarded-Host` and its scheme in `X-Forwarded-Proto`. Plain HTTP and websockets both.
 *
 *   tunnel(listenPort, serverPort) -> Promise<http.Server>
 */

import http from 'node:http';
import net from 'node:net';

/** The request's headers as the server is to be handed them: Host its own, the page's host forwarded. */
export function forwarded(headers, serverPort) {
  const out = { ...headers };
  out['x-forwarded-host'] = headers.host;
  out['x-forwarded-proto'] = 'http';
  out.host = `127.0.0.1:${serverPort}`;
  return out;
}

export function tunnel(listenPort, serverPort) {
  const server = http.createServer((request, response) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: serverPort, method: request.method, path: request.url, headers: forwarded(request.headers, serverPort) },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  // A websocket: the handshake written on with the same rewriting, then the two sockets joined.
  server.on('upgrade', (request, socket, head) => {
    const upstream = net.connect(serverPort, '127.0.0.1', () => {
      const headers = forwarded(request.headers, serverPort);
      const lines = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value.map((v) => `${name}: ${v}`) : [`${name}: ${value}`]));
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const end = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on('error', end);
    socket.on('error', end);
  });
  return new Promise((ready) => server.listen(listenPort, '127.0.0.1', () => ready(server)));
}
