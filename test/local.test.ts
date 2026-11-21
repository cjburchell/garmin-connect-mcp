import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLocalServer } from '../src/local-http.js';
import { createToolContext } from '../src/mcp-server.js';
import { trainingSummary } from '../src/tools/training.js';
import { GarminClient, FileTooLargeError } from '../src/garmin/client.js';
import { TokenManager } from '../src/garmin/auth.js';
import { BASE_URL, json, mockGarmin } from './helpers.js';
import { request, type Server } from 'node:http';

const token = 'test-local-token-at-least-32-characters';
let server: Server | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close(); client = undefined;
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
});
async function start(env: Record<string,string> = {}, fake?: typeof fetch) {
  server = createLocalServer({ MCP_AUTH_TOKEN: token, ...env }, fake ? { fetch: fake } : {});
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  return `http://127.0.0.1:${address.port}`;
}
async function connect(url: string) {
  client = new Client({ name: 'local-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}
describe('Windows-compatible local HTTP host', () => {
  it('supports path-mounted proxy discovery without pointing OAuth at another service', async () => {
    const url = await start({ PUBLIC_URL: 'https://garmin.example/garmin', MCP_OAUTH_CLIENT_SECRET: 'a-client-secret-at-least-32-characters' });
    const metadata = await (await fetch(url + '/garmin/.well-known/oauth-authorization-server')).json();
    expect(metadata).toMatchObject({ issuer: 'https://garmin.example/garmin', authorization_endpoint: 'https://garmin.example/garmin/oauth/authorize' });
    const resource = await (await fetch(url + '/.well-known/oauth-protected-resource/mcp')).json();
    expect(resource).toMatchObject({ resource: 'https://garmin.example/garmin/mcp', authorization_servers: ['https://garmin.example/garmin'] });
    expect((await fetch(url + '/mcp')).headers.get('www-authenticate')).toContain('https://garmin.example/garmin/.well-known/');
    const login = await fetch(url + '/oauth/authorize?response_type=code&client_id=garmin-mcp&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect');
    expect(login.headers.get('referrer-policy')).toBe('strict-origin');
    expect(await login.text()).toContain('action="/garmin/oauth/authorize"');
    const nullOrigin = await fetch(url + '/oauth/authorize', { method: 'POST', headers: { origin: 'null' }, body: '' });
    expect(nullOrigin.status).toBe(403);
    const sameOrigin = await fetch(url + '/oauth/authorize', { method: 'POST', headers: { origin: 'https://garmin.example', 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
    expect(sameOrigin.status).not.toBe(403);
  });
  it('uses only the configured public origin for OAuth behind an authorized proxy', async () => {
    const url = await start({ PUBLIC_URL: 'https://garmin.example:8443', MCP_OAUTH_CLIENT_SECRET: 'a-client-secret-at-least-32-characters' });
    const response = await fetch(url + '/.well-known/oauth-authorization-server');
    expect(await response.json()).toMatchObject({ issuer: 'https://garmin.example:8443', token_endpoint: 'https://garmin.example:8443/oauth/token' });
    expect((await fetch(url + '/mcp', { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
  });
  it('serves health and discovers all tools without Garmin credentials or network', async () => {
    const url = await start();
    expect(await (await fetch(url + '/health')).json()).toMatchObject({ status: 'ok', garminConfigured: false, liveAccessEnabled: false });
    const c = await connect(url);
    expect((await c.listTools()).tools).toHaveLength(27);
    const result = await c.callTool({ name: 'garmin_get_user_settings', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Configure GARMIN_API_KEY');
  });
  it('rejects unauthorized clients, foreign hosts, foreign origins and oversized requests', async () => {
    const url = await start();
    expect((await fetch(url + '/mcp')).status).toBe(401);
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url + '/health', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(wrongHostStatus).toBe(403);
    expect((await fetch(url + '/health', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(url + '/mcp', { method: 'POST', body: 'x'.repeat(65537) })).status).toBe(413);
  });
  it('refuses Garmin calls until explicitly enabled', async () => {
    const c = await connect(await start({ GARMIN_API_KEY: 'fake' }));
    expect(JSON.stringify(await c.callTool({ name: 'garmin_get_user_settings', arguments: {} }))).toContain('Live Garmin access is disabled');
  });
  it('retrieves activity details and reports missing recovery data through HTTP', async () => {
    const fake = mockGarmin(call => call.url.includes('/activity-service/') ? json({ activityId: 123, summaryDTO: { distance: 1000 } }) : new Response(null, { status: 204 }));
    const c = await connect(await start({ GARMIN_API_KEY: 'fake', GARMIN_API_BASE_URL: BASE_URL }, fake.fetch));
    expect(JSON.stringify(await c.callTool({ name: 'garmin_get_activity', arguments: { activityId: 123 } }))).toContain('1000');
    for (const name of ['garmin_get_hrv', 'garmin_get_sleep']) {
      expect(JSON.stringify(await c.callTool({ name, arguments: name.endsWith('hrv') ? { calendarDate: '2026-11-20' } : { date: '2026-11-20' } }))).toContain('noData');
    }
  });
});
describe('training summaries', () => {
  const args = { startDate: '2026-11-01', endDate: '2026-11-20', activityType: 'running' };
  const context = (fake: ReturnType<typeof mockGarmin>) => createToolContext({ apiKey: 'fake', baseUrl: BASE_URL }, { fetch: fake.fetch });
  it('filters dates, forwards type, deduplicates, groups Mondays, and preserves missing metrics', async () => {
    const fake = mockGarmin(() => json([
      { activityId: 1, startTimeLocal: '2026-11-02 08:00:00', duration: 60, distance: 1000, averageHR: 140 },
      { activityId: 1, startTimeLocal: '2026-11-02 08:00:00', duration: 60, distance: 1000, averageHR: 140 },
      { activityId: 2, startTimeLocal: '2026-11-10 08:00:00', duration: 120, maxHR: 170 },
      { activityId: 3, startTimeLocal: '2026-10-30 08:00:00', duration: 999 },
    ]));
    const result = await trainingSummary(args, context(fake));
    expect(result).toMatchObject({ totalActivities: 2, complete: true, durationSeconds: { value: 180 }, elevationGainMeters: { value: null }, averageActivityHeartRateBpm: 140, maxHeartRateBpm: 170 });
    expect(result.weekly.map(w => w.weekStart)).toEqual(['2026-11-02', '2026-11-09']);
    expect(fake.dataCalls()[0]?.url).toContain('activityType=running');
  });
  it('handles empty results and rejects malformed parameters before API access', async () => {
    const fake = mockGarmin(() => json([]));
    expect(await trainingSummary(args, context(fake))).toMatchObject({ totalActivities: 0, complete: true });
    for (const bad of [{ ...args, startDate: '2026-02-30' }, { ...args, endDate: '2026-10-01' }, { ...args, activityType: true }, { ...args, startDate: '2020-01-01' }]) {
      await expect(trainingSummary(bad, context(fake))).rejects.toThrow();
    }
    expect(fake.dataCalls()).toHaveLength(1);
  });
  it('marks capped pagination incomplete rather than returning misleading full totals', async () => {
    const fake = mockGarmin(call => { const offset = Number(new URL(call.url).searchParams.get('start')); return json(Array.from({ length: 100 }, (_, i) => ({ activityId: offset+i, startTimeLocal: '2026-11-02 08:00:00', duration: 1 }))); });
    expect(await trainingSummary(args, context(fake))).toMatchObject({ totalActivities: 500, complete: false });
    expect(fake.dataCalls()).toHaveLength(5);
  });
  it('propagates upstream errors and timeouts', async () => {
    await expect(trainingSummary(args, context(mockGarmin(() => json({}, 503))))).rejects.toThrow(/server error/);
    await expect(trainingSummary(args, context(mockGarmin(() => { throw new DOMException('timeout', 'TimeoutError'); })))).rejects.toThrow(/timeout/);
  });
});
it('caps JSON responses with or without declared length', async () => {
  for (const declared of [true,false]) {
    const fake = mockGarmin(() => new Response('x'.repeat(1024*1024+1), { headers: declared ? { 'content-length': String(1024*1024+1) } : {} }));
    const c = new GarminClient({ baseUrl: BASE_URL, tokens: new TokenManager({ apiKey: 'fake', baseUrl: BASE_URL, fetch: fake.fetch }), fetch: fake.fetch });
    await expect(c.getJson('/large')).rejects.toBeInstanceOf(FileTooLargeError);
  }
});
