import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHttpHandler, type HttpHandlerOptions } from './http.js';

const MAX_REQUEST_BYTES = 64 * 1024;
export function createLocalServer(env = process.env, options: HttpHandlerOptions = {}): Server {
  const publicOrigin = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : undefined;
  if (publicOrigin && (!publicOrigin.startsWith('https://') || new URL(env.PUBLIC_URL!).pathname !== '/')) throw new Error('PUBLIC_URL must be an HTTPS origin without a path.');
  // Discovery works before account setup; this placeholder can never reach Garmin.
  const guardedFetch: typeof fetch = async (input, init) => {
    if (!env.GARMIN_API_KEY?.trim()) throw new Error('Configure GARMIN_API_KEY locally before querying Garmin.');
    if (env.GARMIN_ALLOW_NETWORK !== 'true') throw new Error('Live Garmin access is disabled. Obtain approval, then set GARMIN_ALLOW_NETWORK=true.');
    const url = new URL(String(input));
    if (url.origin !== 'https://personal.connectapi.garmin.com') throw new Error('Only the official Garmin Personal API is allowed.');
    const response = await fetch(input, { ...init, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      return new Response(null, { status: response.status });
    }
    return response;
  };
  const handle = createHttpHandler({ ...options, env: { ...env, GARMIN_API_KEY: env.GARMIN_API_KEY || 'not-configured' }, fetch: options.fetch ?? guardedFetch });
  return createServer(async (req, res) => {
    const started = Date.now();
    const origin = `http://127.0.0.1:${(res.socket?.localPort)}`;
    const allowedHosts = [new URL(origin).host, `localhost:${res.socket?.localPort}`];
    if (publicOrigin) allowedHosts.push(new URL(publicOrigin).host);
    const allowedOrigins = [origin, origin.replace('127.0.0.1', 'localhost'), ...(publicOrigin ? [publicOrigin] : [])];
    if (!allowedHosts.includes(req.headers.host ?? '') || (req.headers.origin && !allowedOrigins.includes(req.headers.origin))) {
      res.writeHead(403).end('Host or Origin refused'); return;
    }
    try {
      const url = new URL(req.url ?? '/', publicOrigin ?? origin);
      if (url.origin !== (publicOrigin ?? origin)) { res.writeHead(403).end('Request origin refused'); return; }
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: 'ok', garminConfigured: Boolean(env.GARMIN_API_KEY?.trim()), liveAccessEnabled: env.GARMIN_ALLOW_NETWORK === 'true', transport: 'streamable-http' }));
        return;
      }
      if (url.pathname !== '/mcp' && !url.pathname.startsWith('/oauth/') && !url.pathname.startsWith('/.well-known/')) {
        res.writeHead(404).end('Not found'); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) { res.writeHead(413).end('Request too large'); return; }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const response = await handle(new Request(url, { method: req.method, headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); } }
        finally { reader.releaseLock(); }
      }
      res.end();
      // No URLs, headers, parameters, personal data or error bodies in diagnostics.
      console.error(`[local-http] request status=${response.status} durationMs=${Date.now() - started}`);
    } catch {
      console.error('[local-http] request failed');
      if (!res.headersSent) res.writeHead(500);
      res.end('Request failed');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8091);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  if (!process.env.MCP_AUTH_TOKEN || process.env.MCP_AUTH_TOKEN.length < 24) throw new Error('Set MCP_AUTH_TOKEN to a random secret of at least 24 characters.');
  const server = createLocalServer();
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('HOST must be 127.0.0.1, or 0.0.0.0 inside Docker.');
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.on('error', () => { console.error('[local-http] listener failed; check PORT availability'); process.exitCode = 1; });
  server.listen(port, host, () => console.error(`[local-http] listening on http://${host}:${port}/mcp`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
}
