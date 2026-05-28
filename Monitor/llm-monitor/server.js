import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIN_INTERVAL_SEC = 10;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_LOGS = 120;
const MAX_DIAGNOSTICS = 40;
const MAX_HISTORY = 200;
const AZURE_API_VERSION = '2024-02-15-preview';

const PROXY_SOURCE =
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/refs/heads/main/proxies/countries/RU/data.txt';
const PROXY_TTL_MS = 5 * 60 * 1000;

const clients = new Set();
const timers = new Map();
const controllers = new Map();
const running = new Set();
const rerun = new Set();
const queue = [];

let activeChecks = 0;
let saveTimer = null;
let proxyCache = { fetchedAt: 0, list: [] };

const state = {
  schemaVersion: 6,
  runtime: {
    paused: false,
    nextTickAt: null,
    logs: [],
    changeSeq: 0,
    lastChange: null
  },
  settings: {
    defaultIntervalSec: 60,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    endpointConcurrency: 4,
    modelConcurrency: 12,
    alertVolume: 0.45
  },
  endpoints: []
};

class ApiError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status}: ${String(body).slice(0, 260)}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function log(level, ...args) {
  const line =
    `[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} ` +
    args
      .map(x =>
        x instanceof Error
          ? x.message
          : typeof x === 'object'
            ? JSON.stringify(x)
            : String(x)
      )
      .join(' ');

  state.runtime.logs = [
    ...state.runtime.logs.slice(-(MAX_LOGS - 1)),
    { level, line }
  ];

  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    line
  );

  broadcast({ type: 'logs', logs: state.runtime.logs });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 180);
}

async function saveState() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(
      {
        schemaVersion: state.schemaVersion,
        settings: state.settings,
        endpoints: state.endpoints
      },
      null,
      2
    ),
    'utf8'
  );
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);

    if (data.settings) state.settings = normalizeSettings(data.settings);
    if (Array.isArray(data.endpoints)) {
      state.endpoints = data.endpoints.map(normalizeEndpoint);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('warn', 'Не удалось загрузить состояние:', error.message);
    }
  }
}

function normalizeSettings(input = {}) {
  return {
    defaultIntervalSec: Math.max(
      MIN_INTERVAL_SEC,
      Number(input.defaultIntervalSec) || 60
    ),
    timeoutMs: Math.max(1000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS),
    endpointConcurrency: clamp(Number(input.endpointConcurrency) || 4, 1, 20),
    modelConcurrency: clamp(Number(input.modelConcurrency) || 12, 1, 50),
    alertVolume: clamp(
      input.alertVolume == null ? 0.45 : Number(input.alertVolume),
      0,
      1
    )
  };
}

function normalizeEndpoint(e = {}) {
  return {
    id: e.id || uid(),
    name: e.name || e.url || 'endpoint',
    url: String(e.url || '').trim(),
    proxyUrl: String(e.proxyUrl || '').trim(),
    proxyLastCheck: e.proxyLastCheck || null,
    providerType: normalizeProviderType(e.providerType),
    apiKey: String(e.apiKey || ''),
    group: e.group || 'work',
    intervalSec: Math.max(
      MIN_INTERVAL_SEC,
      Number(e.intervalSec) || state.settings.defaultIntervalSec
    ),
    paused: Boolean(e.paused),
    status: e.status || 'idle',
    models: Array.isArray(e.models) ? e.models : [],
    excluded: Array.isArray(e.excluded) ? e.excluded : [],
    failCount: Number(e.failCount) || 0,
    lastCheck: e.lastCheck || null,
    latencyMs: Number(e.latencyMs) || 0,
    lastError: e.lastError || '',
    nextDueAt: e.nextDueAt || null,
    lastChangeAt: e.lastChangeAt || null,
    checkSignature: e.checkSignature || '',
    diagnostics: Array.isArray(e.diagnostics)
      ? e.diagnostics.slice(0, MAX_DIAGNOSTICS)
      : [],
    history: Array.isArray(e.history) ? e.history.slice(0, MAX_HISTORY) : []
  };
}

function publicEndpoint(e) {
  return {
    ...e,
    apiKey: undefined,
    apiKeySet: Boolean(e.apiKey),
    diagnostics: undefined,
    checkSignature: undefined
  };
}

function publicState() {
  return {
    schemaVersion: state.schemaVersion,
    runtime: state.runtime,
    settings: state.settings,
    endpoints: state.endpoints.map(publicEndpoint)
  };
}

function broadcast(payload) {
  const text = JSON.stringify(payload);

  for (const ws of clients) {
    try {
      wsSend(ws, text);
    } catch {
      clients.delete(ws);
    }
  }
}

function emitState() {
  updateNextTick();
  broadcast({ type: 'state', state: publicState() });
}

function updateEndpoint(id, patch, persist = true) {
  const index = state.endpoints.findIndex(e => e.id === id);
  if (index < 0) return null;

  state.endpoints[index] = { ...state.endpoints[index], ...patch };

  if (persist) scheduleSave();
  emitState();

  return state.endpoints[index];
}

function findEndpoint(id) {
  return state.endpoints.find(e => e.id === id);
}

function maskSecret(value) {
  return String(value || '').replace(
    /(Bearer\s+|x-api-key:\s*|api-key:\s*|key=)([A-Za-z0-9._-]+)/gi,
    (_, p, s) => `${p}***${s.slice(-4)}`
  );
}

function recordDiagnostic(endpointId, method, url, status, body, latencyMs) {
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) return;

  endpoint.diagnostics = [
    {
      timestamp: nowIso(),
      method,
      url: maskSecret(url),
      status,
      latencyMs: Math.round(latencyMs || 0),
      body:
        typeof body === 'string'
          ? body.slice(0, 1600)
          : JSON.stringify(body).slice(0, 1600)
    },
    ...(endpoint.diagnostics || [])
  ].slice(0, MAX_DIAGNOSTICS);

  scheduleSave();
}

function pushHistory(endpoint, status, okCount, failCount, latencyMs, message = '') {
  endpoint.history = [
    {
      timestamp: nowIso(),
      status,
      okCount,
      failCount,
      latencyMs: Math.round(latencyMs || 0),
      message: String(message || '').slice(0, 260)
    },
    ...(endpoint.history || [])
  ].slice(0, MAX_HISTORY);
}

function normalizeSseText(text) {
  if (!text || !text.includes('data:')) return text;

  const lines = text.split('\n').map(line => line.trim());

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('data:')) continue;

    const payload = lines[i].slice(5).trim();
    if (payload && payload !== '[DONE]') return payload;
  }

  return text;
}

function throwIfHtml(status, bodyText, url) {
  const text = String(bodyText || '').trim();
  if (!/^<(!doctype|html)/i.test(text)) return;

  const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const h1 = text.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1];

  throw new ApiError(
    status,
    `Неверный формат ответа: HTML (${h1 || title || 'HTML response'})`,
    url
  );
}

async function requestJson(endpoint, url, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || state.settings.timeoutMs);
  const started = performance.now();
  let status = 0;
  let text = '';

  try {
    if (endpoint?.proxyUrl) {
      const r = await requestViaProxy(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        timeoutMs,
        signal: options.signal,
        proxyUrl: endpoint.proxyUrl
      });

      status = r.status;
      text = normalizeSseText(r.body);
    } else {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException('timeout', 'AbortError')),
        timeoutMs
      );

      if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else {
          options.signal.addEventListener(
            'abort',
            () => controller.abort(options.signal.reason),
            { once: true }
          );
        }
      }

      try {
        const response = await fetch(url, {
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body,
          signal: controller.signal
        });

        status = response.status;
        text = normalizeSseText(await response.text());
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    const latencyMs = performance.now() - started;
    const message =
      error?.name === 'AbortError'
        ? `Запрос прерван или истёк timeout ${timeoutMs} мс`
        : `Сетевая ошибка backend → provider: ${error.message}`;

    recordDiagnostic(endpoint?.id, options.method || 'GET', url, 0, message, latencyMs);
    throw new Error(message);
  }

  const latencyMs = performance.now() - started;

  recordDiagnostic(endpoint?.id, options.method || 'GET', url, status, text, latencyMs);
  throwIfHtml(status, text, url);

  if (status < 200 || status >= 300) throw new ApiError(status, text, url);

  try {
    return { json: text ? JSON.parse(text) : {}, latencyMs };
  } catch {
    throw new Error('Provider вернул невалидный JSON');
  }
}

/* ----------------------------- proxy engine ----------------------------- */

function proxyProtocol(value) {
  return new URL(value).protocol.replace(':', '').toLowerCase();
}

function validateProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const u = new URL(raw);
  const proto = proxyProtocol(raw);

  if (!['http', 'https', 'socks4', 'socks5'].includes(proto)) {
    throw new Error('Прокси должен быть http/https/socks4/socks5');
  }

  if (!u.hostname || !u.port) {
    throw new Error('Прокси должен содержать host и port');
  }

  return raw;
}

async function fetchFreeProxies(force = false) {
	  if (!force && Date.now() - proxyCache.fetchedAt < PROXY_TTL_MS && proxyCache.list.length) {
	    return proxyCache.list;
	  }
	
	  const controller = new AbortController();
	  const timer = setTimeout(() => controller.abort(new Error('Proxy source timeout')), 8000);
	
	  let response;
	  try {
	    response = await fetch(PROXY_SOURCE, {
	      cache: 'no-store',
	      signal: controller.signal,
	      headers: {
	        // Под некоторыми VPN/прокси GitHub raw может быть чувствителен к отсутствию UA.
	        'User-Agent': 'llm-monitor/1.0'
	      }
	    });
	  } finally {
	    clearTimeout(timer);
	  }
	
	  if (!response.ok) throw new Error(`Proxy source HTTP ${response.status}`);


  const text = await response.text();

  const list = [
    ...new Set(
      text
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .filter(x => /^(https?|socks4|socks5):\/\/[^:\s]+:\d+$/i.test(x))
    )
  ];

  proxyCache = { fetchedAt: Date.now(), list };

  return list;
}

async function assertProxyFromList(value) {
  const proxy = validateProxyUrl(value);
  if (!proxy) return '';

  // Для UX допускаем любые валидные прокси.
  // Список proxifly используем как подсказку/источник, но не как строгую валидацию,
  // иначе прокси часто "не работает" из-за устаревания списка/сетевых ограничений.
  try {
    await fetchFreeProxies(false);
  } catch {
    // Игнорируем ошибки получения списка.
  }

  return proxy;
}

function readUntil(socket, marker, timeoutMs, signal) {
  const mark = Buffer.from(marker);

  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error('proxy timeout')), timeoutMs);

    const onAbort = () => done(signal.reason || new DOMException('aborted', 'AbortError'));
    const onError = error => done(error);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const i = buf.indexOf(mark);

      if (i >= 0) done(null, buf.subarray(0, i + mark.length).toString('latin1'));
      else if (buf.length > 128 * 1024) done(new Error('proxy response too large'));
    };

    function done(error, data) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(data);
    }

    socket.on('data', onData);
    socket.once('error', onError);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function readExact(socket, size, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error('proxy timeout')), timeoutMs);

    const onAbort = () => done(signal.reason || new DOMException('aborted', 'AbortError'));
    const onError = error => done(error);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= size) done(null, buf.subarray(0, size));
    };

    function done(error, data) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(data);
    }

    socket.on('data', onData);
    socket.once('error', onError);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function connectTcp(host, port, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => done(new Error('connect timeout')), timeoutMs);

    const onAbort = () => done(signal.reason || new DOMException('aborted', 'AbortError'));
    const onConnect = () => done(null, socket);
    const onError = error => done(error);

    function done(error, result) {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('error', onError);
      signal?.removeEventListener('abort', onAbort);

      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(result);
      }
    }

    socket.once('connect', onConnect);
    socket.once('error', onError);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function wrapTls(socket, host, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    const timer = setTimeout(() => done(new Error('TLS timeout')), timeoutMs);

    const onAbort = () => done(signal.reason || new DOMException('aborted', 'AbortError'));
    const onConnect = () => done(null, secure);
    const onError = error => done(error);

    function done(error, result) {
      clearTimeout(timer);
      secure.off('secureConnect', onConnect);
      secure.off('error', onError);
      signal?.removeEventListener('abort', onAbort);

      if (error) {
        secure.destroy();
        reject(error);
      } else {
        resolve(result);
      }
    }

    secure.once('secureConnect', onConnect);
    secure.once('error', onError);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function connectViaHttpProxy(proxy, target, timeoutMs, signal) {
  let socket = await connectTcp(proxy.hostname, Number(proxy.port), timeoutMs, signal);

  if (proxy.protocol === 'https:') {
    socket = await wrapTls(socket, proxy.hostname, timeoutMs, signal);
  }

  const targetPort = target.port || (target.protocol === 'https:' ? 443 : 80);

  const auth =
    proxy.username || proxy.password
      ? `Proxy-Authorization: Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
        ).toString('base64')}\r\n`
      : '';

  socket.write(
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${target.hostname}:${targetPort}\r\n` +
      auth +
      `Connection: keep-alive\r\n\r\n`
  );

  const head = await readUntil(socket, '\r\n\r\n', timeoutMs, signal);
  const status = Number(head.match(/^HTTP\/\d\.\d\s+(\d+)/i)?.[1] || 0);

  if (status !== 200) {
    socket.destroy();
    throw new Error(`HTTP proxy CONNECT failed: ${status}`);
  }

  if (target.protocol === 'https:') {
    socket = await wrapTls(socket, target.hostname, timeoutMs, signal);
  }

  return socket;
}

async function connectViaSocks5(proxy, target, timeoutMs, signal) {
  const socket = await connectTcp(proxy.hostname, Number(proxy.port), timeoutMs, signal);

  socket.write(Buffer.from([0x05, 0x01, 0x00]));

  const hello = await readExact(socket, 2, timeoutMs, signal);
  if (hello[0] !== 0x05 || hello[1] !== 0x00) {
    socket.destroy();
    throw new Error('SOCKS5 no-auth rejected');
  }

  const host = Buffer.from(target.hostname);
  if (host.length > 255) throw new Error('SOCKS5 host too long');

  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const req = Buffer.alloc(7 + host.length);

  req[0] = 0x05;
  req[1] = 0x01;
  req[2] = 0x00;
  req[3] = 0x03;
  req[4] = host.length;
  host.copy(req, 5);
  req.writeUInt16BE(port, 5 + host.length);

  socket.write(req);

  const first = await readExact(socket, 5, timeoutMs, signal);
  if (first[1] !== 0x00) {
    socket.destroy();
    throw new Error(`SOCKS5 connect failed: ${first[1]}`);
  }

  const atyp = first[3];
  const rest =
    atyp === 0x01 ? 5 : atyp === 0x03 ? first[4] + 2 : atyp === 0x04 ? 17 : 0;

  if (rest) await readExact(socket, rest, timeoutMs, signal);

  return target.protocol === 'https:'
    ? await wrapTls(socket, target.hostname, timeoutMs, signal)
    : socket;
}

async function connectViaSocks4(proxy, target, timeoutMs, signal) {
  const socket = await connectTcp(proxy.hostname, Number(proxy.port), timeoutMs, signal);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const host = Buffer.from(target.hostname);
  const ip = net.isIP(target.hostname);

  let req;

  if (ip === 4) {
    req = Buffer.alloc(9);
    req[0] = 0x04;
    req[1] = 0x01;
    req.writeUInt16BE(port, 2);
    Buffer.from(target.hostname.split('.').map(Number)).copy(req, 4);
    req[8] = 0;
  } else {
    req = Buffer.alloc(10 + host.length);
    req[0] = 0x04;
    req[1] = 0x01;
    req.writeUInt16BE(port, 2);
    req[4] = 0;
    req[5] = 0;
    req[6] = 0;
    req[7] = 1;
    req[8] = 0;
    host.copy(req, 9);
    req[9 + host.length] = 0;
  }

  socket.write(req);

  const res = await readExact(socket, 8, timeoutMs, signal);

  if (res[1] !== 0x5a) {
    socket.destroy();
    throw new Error(`SOCKS4 connect failed: ${res[1]}`);
  }

  return target.protocol === 'https:'
    ? await wrapTls(socket, target.hostname, timeoutMs, signal)
    : socket;
}

async function openSocket(target, proxyUrl, timeoutMs, signal) {
  if (!proxyUrl) {
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const socket = await connectTcp(target.hostname, port, timeoutMs, signal);

    return target.protocol === 'https:'
      ? await wrapTls(socket, target.hostname, timeoutMs, signal)
      : socket;
  }

  const proxy = new URL(proxyUrl);

  if (proxy.protocol === 'http:' || proxy.protocol === 'https:') {
    return connectViaHttpProxy(proxy, target, timeoutMs, signal);
  }

  if (proxy.protocol === 'socks5:') {
    return connectViaSocks5(proxy, target, timeoutMs, signal);
  }

  if (proxy.protocol === 'socks4:') {
    return connectViaSocks4(proxy, target, timeoutMs, signal);
  }

  throw new Error('Unsupported proxy protocol');
}

function decodeChunked(buffer) {
  let pos = 0;
  const chunks = [];

  while (pos < buffer.length) {
    const end = buffer.indexOf('\r\n', pos, 'latin1');
    if (end < 0) break;

    const size = parseInt(buffer.subarray(pos, end).toString('latin1'), 16);
    if (!size) break;

    pos = end + 2;
    chunks.push(buffer.subarray(pos, pos + size));
    pos += size + 2;
  }

  return Buffer.concat(chunks);
}

async function requestViaProxy(url, options) {
  const target = new URL(url);
  const timeoutMs = options.timeoutMs;
  const socket = await openSocket(target, options.proxyUrl, timeoutMs, options.signal);
  const body = options.body == null ? null : Buffer.from(String(options.body));
  const headers = { ...(options.headers || {}) };

  headers.Host = target.host;
  headers.Connection = 'close';
  headers.Accept = headers.Accept || 'application/json,text/event-stream,*/*';

  // Нужен для многих API (включая OpenAI): иначе часто получаем HTML/Not Found/400.
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = 'llm-monitor/1.0';
  }

  // В HTTP/1.1 без chunked нужно явно закрывать тело.
  if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = body.length;
  }
  if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  // Для HTTP-прокси (не CONNECT) в request-line должен быть absolute-form URL.
  // Иначе многие прокси не смогут смаршрутизировать запрос и будут "висеть"/дропать.
  const requestPath = options.proxyUrl && target.protocol === 'http:'
    ? target.href
    : (target.pathname || '/') + (target.search || '');

  const requestHead =
    `${options.method || 'GET'} ${requestPath} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\n` +
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') +
    '\r\n\r\n';

  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;

    const timer = setTimeout(() => done(new Error('proxy request timeout')), timeoutMs);
    const onAbort = () => done(options.signal.reason || new DOMException('aborted', 'AbortError'));
    const onError = error => done(error);
    const onData = chunk => {
      size += chunk.length;
      if (size > 8_000_000) return done(new Error('response too large'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const raw = Buffer.concat(chunks);
        const split = raw.indexOf('\r\n\r\n', 0, 'latin1');

        if (split < 0) throw new Error('bad HTTP response from proxy tunnel');

        const head = raw.subarray(0, split).toString('latin1');
        let bodyBuf = raw.subarray(split + 4);
        const status = Number(head.match(/^HTTP\/\d\.\d\s+(\d+)/i)?.[1] || 0);
        const headers = Object.fromEntries(
          head
            .split('\r\n')
            .slice(1)
            .map(line => {
              const i = line.indexOf(':');
              return i < 0
                ? null
                : [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
            })
            .filter(Boolean)
        );

        if (/chunked/i.test(headers['transfer-encoding'] || '')) {
          bodyBuf = decodeChunked(bodyBuf);
        }

        done(null, {
          status,
          headers,
          body: bodyBuf.toString('utf8')
        });
      } catch (error) {
        done(error);
      }
    };

    function done(error, data) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      options.signal?.removeEventListener('abort', onAbort);
      socket.destroy();

      error ? reject(error) : resolve(data);
    }

    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);

    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    socket.write(requestHead);
    if (body) socket.write(body);
  });
}

/* ----------------------------- providers ----------------------------- */

class ProviderAdapter {
  static type = 'base';
  static label = 'Base';

  static normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  static detect() {
    return null;
  }

  async listModels() {
    throw new Error('not implemented');
  }

  async testModel() {
    throw new Error('not implemented');
  }
}

function ensureVersionedBase(url, fallback, version) {
  const normalized = ProviderAdapter.normalizeBaseUrl(url || fallback);
  return /\/v\d+(beta)?$/i.test(normalized) ? normalized : `${normalized}/${version}`;
}

class OpenAIAdapter extends ProviderAdapter {
  static type = 'openai';
  static label = 'OpenAI';

  static detect(url) {
    return url.includes('api.openai.com') ? { confidence: 1 } : null;
  }

  static normalizeBaseUrl(url) {
    return ensureVersionedBase(url, 'https://api.openai.com/v1', 'v1');
  }

  headers(apiKey) {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  async listModels(o) {
    const base = OpenAIAdapter.normalizeBaseUrl(o.baseUrl);

    const r = await requestJson(o.endpoint, `${base}/models`, {
      headers: this.headers(o.apiKey),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    const rows = r.json.data || r.json.models || [];

    return {
      models: rows.map(x => ({ id: x.id, displayName: x.id, raw: x })).filter(m => m.id),
      latencyMs: r.latencyMs
    };
  }

  async testModel(o) {
    const base = OpenAIAdapter.normalizeBaseUrl(o.baseUrl);
    const started = performance.now();

    await requestJson(o.endpoint, `${base}/chat/completions`, {
      method: 'POST',
      headers: { ...this.headers(o.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: o.modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      }),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return { ok: true, latencyMs: performance.now() - started };
  }
}

class OpenAIResponsesAdapter extends OpenAIAdapter {
  static type = 'openai-responses';
  static label = 'OpenAI Responses';

  async testModel(o) {
    const base = OpenAIAdapter.normalizeBaseUrl(o.baseUrl);
    const started = performance.now();

    await requestJson(o.endpoint, `${base}/responses`, {
      method: 'POST',
      headers: { ...this.headers(o.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: o.modelId,
        input: 'ping',
        max_output_tokens: 1,
        stream: false
      }),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return { ok: true, latencyMs: performance.now() - started };
  }
}

class NewAPIAdapter extends OpenAIAdapter {
  static type = 'newapi';
  static label = 'New API';

  static detect(url) {
    return /newapi|new-api/i.test(url) ? { confidence: 0.9 } : null;
  }

  static normalizeBaseUrl(url) {
    return ensureVersionedBase(url, '', 'v1');
  }
}

class AnthropicAdapter extends ProviderAdapter {
  static type = 'anthropic';
  static label = 'Anthropic';

  static detect(url) {
    return url.includes('api.anthropic.com') ? { confidence: 1 } : null;
  }

  static normalizeBaseUrl(url) {
    return ensureVersionedBase(url, 'https://api.anthropic.com/v1', 'v1');
  }

  headers(apiKey) {
    return { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' };
  }

  async listModels(o) {
    const r = await requestJson(o.endpoint, `${AnthropicAdapter.normalizeBaseUrl(o.baseUrl)}/models`, {
      headers: this.headers(o.apiKey),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return {
      models: (r.json.data || [])
        .map(x => ({
          id: x.id,
          displayName: x.display_name || x.id,
          raw: x
        }))
        .filter(m => m.id),
      latencyMs: r.latencyMs
    };
  }

  async testModel(o) {
    const started = performance.now();

    await requestJson(o.endpoint, `${AnthropicAdapter.normalizeBaseUrl(o.baseUrl)}/messages`, {
      method: 'POST',
      headers: { ...this.headers(o.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: o.modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return { ok: true, latencyMs: performance.now() - started };
  }
}

class GeminiAdapter extends ProviderAdapter {
  static type = 'gemini';
  static label = 'Gemini';

  static detect(url) {
    return /generativelanguage\.googleapis\.com|aistudio|gemini/i.test(url)
      ? { confidence: 1 }
      : null;
  }

  static normalizeBaseUrl(url) {
    return ensureVersionedBase(
      url,
      'https://generativelanguage.googleapis.com/v1beta',
      'v1beta'
    );
  }

  makeUrl(base, pathPart, key) {
    const sep = pathPart.includes('?') ? '&' : '?';
    return key ? `${base}${pathPart}${sep}key=${encodeURIComponent(key)}` : `${base}${pathPart}`;
  }

  async listModels(o) {
    const base = GeminiAdapter.normalizeBaseUrl(o.baseUrl);

    const r = await requestJson(o.endpoint, this.makeUrl(base, '/models', o.apiKey), {
      headers: o.apiKey ? { 'x-goog-api-key': o.apiKey } : {},
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return {
      models: (r.json.models || [])
        .map(x => ({
          id: x.name,
          displayName: x.displayName || x.name,
          raw: x
        }))
        .filter(m => m.id),
      latencyMs: r.latencyMs
    };
  }

  async testModel(o) {
    const base = GeminiAdapter.normalizeBaseUrl(o.baseUrl);
    const model = o.modelId.startsWith('models/') ? o.modelId : `models/${o.modelId}`;
    const started = performance.now();

    await requestJson(o.endpoint, this.makeUrl(base, `/${model}:generateContent`, o.apiKey), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(o.apiKey ? { 'x-goog-api-key': o.apiKey } : {})
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 }
      }),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return { ok: true, latencyMs: performance.now() - started };
  }
}

class AzureOpenAIAdapter extends ProviderAdapter {
  static type = 'azure-openai';
  static label = 'Azure OpenAI';

  static detect(url) {
    return /openai\.azure\.com/i.test(url) ? { confidence: 1 } : null;
  }

  static normalizeBaseUrl(url) {
    return ProviderAdapter.normalizeBaseUrl(
      String(url || '')
        .replace(/[?#].*$/, '')
        .replace(/\/openai\/deployments.*$/i, '')
    );
  }

  headers(apiKey) {
    return apiKey ? { 'api-key': apiKey } : {};
  }

  async listModels(o) {
    const base = AzureOpenAIAdapter.normalizeBaseUrl(o.baseUrl);

    const r = await requestJson(
      o.endpoint,
      `${base}/openai/deployments?api-version=${AZURE_API_VERSION}`,
      {
        headers: this.headers(o.apiKey),
        timeoutMs: o.timeoutMs,
        signal: o.signal
      }
    );

    const rows = r.json.data || r.json.value || [];

    return {
      models: rows
        .map(x => ({ id: x.id || x.name, displayName: x.id || x.name, raw: x }))
        .filter(m => m.id),
      latencyMs: r.latencyMs
    };
  }

  async testModel(o) {
    const base = AzureOpenAIAdapter.normalizeBaseUrl(o.baseUrl);
    const started = performance.now();

    await requestJson(
      o.endpoint,
      `${base}/openai/deployments/${encodeURIComponent(
        o.modelId
      )}/chat/completions?api-version=${AZURE_API_VERSION}`,
      {
        method: 'POST',
        headers: { ...this.headers(o.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        }),
        timeoutMs: o.timeoutMs,
        signal: o.signal
      }
    );

    return { ok: true, latencyMs: performance.now() - started };
  }
}

class OllamaAdapter extends ProviderAdapter {
  static type = 'ollama';
  static label = 'Ollama';

  static detect(url) {
    return /(^|\/\/)(localhost|127\.0\.0\.1|\[[^\]]+\]|[^/]+):11434/i.test(url)
      ? { confidence: 1 }
      : null;
  }

  static normalizeBaseUrl(url) {
    return ProviderAdapter.normalizeBaseUrl(url || 'http://localhost:11434');
  }

  async listModels(o) {
    const r = await requestJson(o.endpoint, `${OllamaAdapter.normalizeBaseUrl(o.baseUrl)}/api/tags`, {
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return {
      models: (r.json.models || [])
        .map(x => ({ id: x.name, displayName: x.name, raw: x }))
        .filter(m => m.id),
      latencyMs: r.latencyMs
    };
  }

  async testModel(o) {
    const started = performance.now();

    await requestJson(o.endpoint, `${OllamaAdapter.normalizeBaseUrl(o.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: o.modelId,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
        options: { num_predict: 1 }
      }),
      timeoutMs: o.timeoutMs,
      signal: o.signal
    });

    return { ok: true, latencyMs: performance.now() - started };
  }
}

const Providers = {
  openai: OpenAIAdapter,
  'openai-responses': OpenAIResponsesAdapter,
  gemini: GeminiAdapter,
  anthropic: AnthropicAdapter,
  'azure-openai': AzureOpenAIAdapter,
  newapi: NewAPIAdapter,
  ollama: OllamaAdapter
};

function normalizeProviderType(type) {
  const raw = String(type || '').toLowerCase().trim().replace(/_/g, '-');

  const map = {
    openal: 'openai',
    azure: 'azure-openai',
    'azure-openal': 'azure-openai',
    'new-api': 'newapi',
    google: 'gemini',
    'openai-response': 'openai-responses'
  };

  return Providers[raw] ? raw : map[raw] || 'openai';
}

function autoDetectProvider(url) {
  const value = String(url || '').toLowerCase();

  for (const Adapter of Object.values(Providers)) {
    if (Adapter.detect(value)) return Adapter.type;
  }

  return 'openai';
}

function mergeModels(previous = [], next = []) {
  const prev = new Map(previous.map(m => [m.id, m]));

  return next.map(model => {
    const old = prev.get(model.id);

    return {
      ...model,
      firstSeen: old?.firstSeen || nowIso(),
      checkStatus: old?.checkStatus || 'unknown',
      checkError: old?.checkError || '',
      checkLatencyMs: old?.checkLatencyMs || 0
    };
  });
}

async function runPool(items, limit, worker) {
  const list = [...items];
  const count = Math.min(Math.max(1, limit), list.length);

  await Promise.all(
    Array.from({ length: count }, async () => {
      while (list.length) {
        const item = list.shift();
        await worker(item);
      }
    })
  );
}

/* ----------------------------- scheduler ----------------------------- */

function scheduleEndpoint(id) {
  clearEndpointTimer(id);

  const endpoint = findEndpoint(id);
  if (!endpoint || endpoint.paused || state.runtime.paused) return;

  const intervalMs =
    Math.max(MIN_INTERVAL_SEC, Number(endpoint.intervalSec) || state.settings.defaultIntervalSec) *
    1000;

  const dueAt = endpoint.lastCheck ? new Date(endpoint.lastCheck).getTime() + intervalMs : Date.now();
  const delay = Math.max(0, dueAt - Date.now());

  endpoint.nextDueAt = Date.now() + delay;

  const timer = setTimeout(() => {
    timers.delete(id);
    enqueueEndpoint(id, 0);
  }, delay);

  timers.set(id, timer);
  updateNextTick();
  emitState();
}

function clearEndpointTimer(id) {
  const timer = timers.get(id);

  if (timer) clearTimeout(timer);
  timers.delete(id);

  const endpoint = findEndpoint(id);
  if (endpoint) endpoint.nextDueAt = null;

  updateNextTick();
}

function updateNextTick() {
  const due = state.endpoints.filter(e => e.nextDueAt && !e.paused).map(e => e.nextDueAt);
  state.runtime.nextTickAt = due.length ? Math.min(...due) : null;
}

function abortEndpoint(id) {
  controllers.get(id)?.abort(new DOMException('endpoint stopped', 'AbortError'));
  controllers.delete(id);
}

function removeEndpointRuntime(id) {
  clearEndpointTimer(id);
  abortEndpoint(id);

  const index = queue.findIndex(task => task.id === id);
  if (index >= 0) queue.splice(index, 1);

  running.delete(id);
  rerun.delete(id);
}

function enqueueEndpoint(id, priority = 0) {
  if (state.runtime.paused) return;
  if (running.has(id)) return;

  const existing = queue.findIndex(task => task.id === id);
  if (existing >= 0) queue.splice(existing, 1);

  queue.push({ id, priority, seq: Date.now() });
  queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);

  drainQueue();
}

function forceEndpoint(id) {
  clearEndpointTimer(id);

  if (running.has(id)) {
    rerun.add(id);
    abortEndpoint(id);
    return;
  }

  enqueueEndpoint(id, 1);
}

function forceAll() {
  for (const endpoint of state.endpoints) {
    if (!endpoint.paused) forceEndpoint(endpoint.id);
  }
}

function drainQueue() {
  if (state.runtime.paused) return;

  const max = Math.max(1, Number(state.settings.endpointConcurrency) || 4);

  while (activeChecks < max && queue.length) {
    const task = queue.shift();
    const endpoint = findEndpoint(task.id);

    if (!endpoint || endpoint.paused || running.has(task.id)) continue;

    activeChecks += 1;
    running.add(task.id);

    checkEndpoint(task.id)
      .catch(error => {
        if (error?.name !== 'AbortError') log('error', 'Scheduler error:', error.message);
      })
      .finally(() => {
        activeChecks = Math.max(0, activeChecks - 1);
        running.delete(task.id);

        if (rerun.has(task.id)) {
          rerun.delete(task.id);
          enqueueEndpoint(task.id, 1);
        } else {
          scheduleEndpoint(task.id);
        }

        drainQueue();
      });
  }
}

function checkSignature(status, models = [], excluded = [], lastError = '') {
  const off = new Set(excluded);

  return JSON.stringify({
    status,
    tracked: models
      .filter(m => !off.has(m.id))
      .map(m => [m.id, m.checkStatus || 'unknown', m.checkError || ''])
      .sort((a, b) => a[0].localeCompare(b[0])),
    error: status === 'ok' ? '' : String(lastError || '').slice(0, 180)
  });
}

function changePatch(endpoint, status, models, message, beforeSig, hadPrev) {
  const nextSig = checkSignature(status, models, endpoint.excluded || [], message);
  const changed = hadPrev && beforeSig && beforeSig !== nextSig;
  const patch = { checkSignature: nextSig };

  if (changed) {
    const summary = `${endpoint.name}: ${status}`;

    state.runtime.changeSeq += 1;
    state.runtime.lastChange = {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      status,
      message: String(message || '').slice(0, 180),
      timestamp: nowIso()
    };

    patch.lastChangeAt = state.runtime.lastChange.timestamp;
    log('warn', 'Change detected:', summary, message || '');
  }

  return patch;
}

async function checkEndpoint(id) {
  const endpoint = findEndpoint(id);
  if (!endpoint || endpoint.paused) return;

  const Adapter = Providers[endpoint.providerType];

  if (!Adapter) {
    applyFail(endpoint, new Error('Неизвестный провайдер'), true, null, 0, 0, {
      beforeSig: endpoint.checkSignature,
      hadPrev: Boolean(endpoint.lastCheck)
    });
    return;
  }

  const before = {
    beforeSig:
      endpoint.checkSignature ||
      checkSignature(endpoint.status, endpoint.models, endpoint.excluded, endpoint.lastError),
    hadPrev: Boolean(endpoint.lastCheck)
  };

  const controller = new AbortController();
  controllers.set(id, controller);

  updateEndpoint(id, { status: 'checking', lastError: '' }, false);

  try {
    const adapter = new Adapter();

    const listResult = await adapter.listModels({
      endpoint,
      baseUrl: endpoint.url,
      apiKey: endpoint.apiKey,
      timeoutMs: state.settings.timeoutMs,
      signal: controller.signal
    });

    const fresh = findEndpoint(id);
    if (!fresh) return;

    const models = mergeModels(fresh.models || [], listResult.models || []);
    const selected = models.filter(m => !(fresh.excluded || []).includes(m.id));

    if (!selected.length) {
      fresh.models = models;
      applySuccess(fresh, models, listResult.latencyMs, 'ok', 0, 0, '', before);
      return;
    }

    let okCount = 0;
    let failCount = 0;
    let lastError = '';

    for (const model of selected) {
      const item = models.find(m => m.id === model.id);

      if (item) {
        item.checkStatus = 'checking';
        item.checkError = '';
      }
    }

    updateEndpoint(id, { models }, false);

    await runPool(
      selected,
      clamp(Number(state.settings.modelConcurrency) || 12, 1, 50),
      async model => {
        if (controller.signal.aborted) throw controller.signal.reason;

        const index = models.findIndex(m => m.id === model.id);
        if (index < 0) return;

        try {
          const probe = await adapter.testModel({
            endpoint: fresh,
            baseUrl: fresh.url,
            apiKey: fresh.apiKey,
            modelId: model.id,
            timeoutMs: state.settings.timeoutMs,
            signal: controller.signal
          });

          okCount += 1;

          models[index] = {
            ...models[index],
            checkStatus: 'ok',
            checkError: '',
            checkLatencyMs: probe.latencyMs
          };
        } catch (error) {
          if (error?.name === 'AbortError') throw error;

          failCount += 1;
          lastError = error.message;

          models[index] = {
            ...models[index],
            checkStatus: 'fail',
            checkError: error.message,
            checkLatencyMs: 0
          };
        }
      }
    );

    const status = failCount === 0 ? 'ok' : okCount > 0 ? 'degraded' : 'down';

    if (status === 'down') {
      applyFail(
        fresh,
        new Error(lastError || 'Все отслеживаемые модели не ответили'),
        false,
        models,
        okCount,
        failCount,
        before
      );
    } else {
      applySuccess(
        fresh,
        models,
        listResult.latencyMs,
        status,
        okCount,
        failCount,
        status === 'degraded' ? lastError : '',
        before
      );
    }
  } catch (error) {
    if (error?.name !== 'AbortError') applyFail(endpoint, error, true, null, 0, 0, before);
  } finally {
    controllers.delete(id);
  }
}

function applySuccess(endpoint, models, latencyMs, status, okCount, failCount, message, before) {
  pushHistory(endpoint, status, okCount, failCount, latencyMs, message);

  updateEndpoint(endpoint.id, {
    models,
    status,
    failCount: 0,
    lastCheck: nowIso(),
    latencyMs,
    lastError: message || '',
    ...changePatch(
      endpoint,
      status,
      models,
      message,
      before?.beforeSig,
      before?.hadPrev
    )
  });
}

function applyFail(endpoint, error, listFail, models = null, okCount = 0, failCount = 0, before = {}) {
  const isAuth = error instanceof ApiError && [401, 403].includes(error.status);
  const isRateLimit = error instanceof ApiError && error.status === 429;
  const status = isAuth ? 'auth_fail' : isRateLimit ? 'rate_limited' : 'down';
  const finalModels = models || endpoint.models;

  pushHistory(endpoint, status, okCount, failCount, 0, error.message);

  updateEndpoint(endpoint.id, {
    models: finalModels,
    status,
    failCount: (endpoint.failCount || 0) + 1,
    paused: isAuth ? true : endpoint.paused,
    lastCheck: nowIso(),
    lastError: error.message || String(error),
    ...changePatch(
      endpoint,
      status,
      finalModels,
      error.message,
      before?.beforeSig,
      before?.hadPrev
    )
  });

  if (listFail) log('warn', 'Endpoint failed:', endpoint.name, error.message);
}

function startScheduler() {
  for (const endpoint of state.endpoints) scheduleEndpoint(endpoint.id);

  setInterval(() => {
    updateNextTick();
    broadcast({ type: 'tick', runtime: state.runtime });
  }, 1000);
}

/* ----------------------------- HTTP API ----------------------------- */

function corsHeaders(req) {
  const origin = req.headers.origin || '*';

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function sendJson(res, req, status, body) {
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(body));
}

function sendText(res, req, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });

  res.end(body);
}

async function readJson(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Payload too large');

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function validateHttpUrl(url) {
  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Разрешены только http/https URL');
  }

  return parsed.toString();
}

async function applyEndpointPatch(endpoint, body) {
  const patch = {};

  if ('name' in body) patch.name = String(body.name || endpoint.name).trim();
  if ('url' in body) patch.url = String(body.url || '').trim();
  if ('proxyUrl' in body) patch.proxyUrl = await assertProxyFromList(body.proxyUrl);
  if ('providerType' in body) patch.providerType = normalizeProviderType(body.providerType);
  if ('group' in body) patch.group = String(body.group || 'work').trim();

  if ('intervalSec' in body) {
    patch.intervalSec = Math.max(MIN_INTERVAL_SEC, Number(body.intervalSec) || endpoint.intervalSec);
  }

  if ('paused' in body) patch.paused = Boolean(body.paused);

  if ('excluded' in body && Array.isArray(body.excluded)) {
    patch.excluded = body.excluded.map(String);
  }

  if ('apiKey' in body && String(body.apiKey).length) {
    patch.apiKey = String(body.apiKey);
  }

  if (body.clearApiKey) patch.apiKey = '';

  return patch;
}

function sanitizeRelayHeaders(input) {
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'upgrade',
    'proxy-authenticate',
    'proxy-authorization',
    'sec-websocket-key',
    'sec-websocket-version'
  ]);

  const result = {};

  for (const [key, value] of Object.entries(input || {})) {
    const name = key.toLowerCase();

    if (blocked.has(name)) continue;
    result[key] = String(value);
  }

  return result;
}

function safeEndpointName(urlValue) {
  try {
    return new URL(urlValue).hostname;
  } catch {
    return 'endpoint';
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, req, 200, publicState());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/providers') {
      sendJson(
        res,
        req,
        200,
        Object.values(Providers).map(P => ({ type: P.type, label: P.label }))
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/proxies') {
      const list = await fetchFreeProxies(url.searchParams.get('refresh') === '1');
      sendJson(res, req, 200, {
        source: PROXY_SOURCE,
        fetchedAt: proxyCache.fetchedAt,
        ttlMs: PROXY_TTL_MS,
        count: list.length,
        proxies: list
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/proxies/random') {
      const list = await fetchFreeProxies(url.searchParams.get('refresh') === '1');
      const proxy = list[Math.floor(Math.random() * list.length)] || '';

      sendJson(res, req, 200, {
        proxy,
        count: list.length,
        fetchedAt: proxyCache.fetchedAt
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/proxy-test') {
      const body = await readJson(req);
      const proxyUrl = await assertProxyFromList(body.proxyUrl || '');
      if (!proxyUrl) throw new Error('Прокси не задан');

      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException('timeout', 'AbortError')),
        Math.max(1000, Number(body.timeoutMs) || state.settings.timeoutMs)
      );

      try {
        const r = await requestViaProxy('https://api.ipify.org?format=json', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          proxyUrl,
          timeoutMs: Math.max(1000, Number(body.timeoutMs) || state.settings.timeoutMs),
          signal: controller.signal
        });

        sendJson(res, req, 200, {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          body: r.body.slice(0, 500),
          latencyMs: Math.round(performance.now() - started)
        });
      } finally {
        clearTimeout(timer);
      }

      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/export') {
      sendJson(res, req, 200, {
        schemaVersion: state.schemaVersion,
        settings: state.settings,
        endpoints: state.endpoints
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/import') {
      const body = await readJson(req);
      if (!Array.isArray(body.endpoints)) throw new Error('Bad import schema');

      for (const endpoint of state.endpoints) removeEndpointRuntime(endpoint.id);

      state.settings = normalizeSettings(body.settings || state.settings);
      state.endpoints = body.endpoints.map(normalizeEndpoint);

      scheduleSave();

      for (const endpoint of state.endpoints) scheduleEndpoint(endpoint.id);

      emitState();
      sendJson(res, req, 200, publicState());
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/api/settings') {
      const body = await readJson(req);

      state.settings = normalizeSettings({ ...state.settings, ...body });

      scheduleSave();

      for (const endpoint of state.endpoints) scheduleEndpoint(endpoint.id);

      drainQueue();
      emitState();
      sendJson(res, req, 200, publicState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pause') {
      const body = await readJson(req);
      state.runtime.paused = Boolean(body.paused);

      if (state.runtime.paused) {
        for (const endpoint of state.endpoints) {
          clearEndpointTimer(endpoint.id);
          abortEndpoint(endpoint.id);
        }
      } else {
        for (const endpoint of state.endpoints) scheduleEndpoint(endpoint.id);
        drainQueue();
      }

      emitState();
      sendJson(res, req, 200, publicState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/force-all') {
      forceAll();
      sendJson(res, req, 202, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/endpoints') {
      const body = await readJson(req);
      const urlValue = String(body.url || '').trim();

      if (!urlValue) throw new Error('URL обязателен');
      validateHttpUrl(urlValue);

      const proxyUrl = body.proxyUrl ? await assertProxyFromList(body.proxyUrl) : '';

      const endpoint = normalizeEndpoint({
        id: uid(),
        name: body.name || safeEndpointName(urlValue),
        url: urlValue,
        proxyUrl,
        providerType: normalizeProviderType(body.providerType || autoDetectProvider(urlValue)),
        apiKey: body.apiKey || '',
        group: body.group || 'work',
        intervalSec: body.intervalSec || state.settings.defaultIntervalSec,
        paused: false,
        status: 'idle'
      });

      const Adapter = Providers[endpoint.providerType];
      if (!Adapter) throw new Error('Неизвестный провайдер');

      const adapter = new Adapter();

      const listResult = await adapter.listModels({
        endpoint,
        baseUrl: endpoint.url,
        apiKey: endpoint.apiKey,
        timeoutMs: state.settings.timeoutMs,
        signal: undefined
      });

      endpoint.models = mergeModels([], listResult.models || []);
      endpoint.lastCheck = nowIso();
      endpoint.latencyMs = listResult.latencyMs;
      endpoint.status = endpoint.models.length ? 'idle' : 'degraded';
      endpoint.lastError = endpoint.models.length ? '' : 'Провайдер ответил, но список моделей пуст';
      endpoint.checkSignature = checkSignature(
        endpoint.status,
        endpoint.models,
        endpoint.excluded,
        endpoint.lastError
      );

      state.endpoints.push(endpoint);

      scheduleSave();
      scheduleEndpoint(endpoint.id);
      emitState();

      log('info', 'Endpoint added:', endpoint.name, `${endpoint.models.length} models`);
      sendJson(res, req, 201, publicEndpoint(endpoint));
      return;
    }

    const endpointMatch = url.pathname.match(/^\/api\/endpoints\/([^/]+)(?:\/([^/]+))?$/);

    if (endpointMatch) {
      const id = decodeURIComponent(endpointMatch[1]);
      const action = endpointMatch[2];
      const endpoint = findEndpoint(id);

      if (!endpoint) {
        sendJson(res, req, 404, { error: 'Endpoint not found' });
        return;
      }

      if (req.method === 'GET' && action === 'diagnostics') {
        sendJson(res, req, 200, {
          endpointId: id,
          diagnostics: endpoint.diagnostics || [],
          history: endpoint.history || []
        });
        return;
      }

      if (req.method === 'PATCH' && !action) {
        const body = await readJson(req);
        const patch = await applyEndpointPatch(endpoint, body);

        if ('paused' in patch && patch.paused) removeEndpointRuntime(id);

        updateEndpoint(id, patch);

        if (!patch.paused) scheduleEndpoint(id);

        sendJson(res, req, 200, publicEndpoint(findEndpoint(id)));
        return;
      }

      if (req.method === 'DELETE' && !action) {
        removeEndpointRuntime(id);

        state.endpoints = state.endpoints.filter(e => e.id !== id);

        scheduleSave();
        emitState();
        sendJson(res, req, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && action === 'force') {
        forceEndpoint(id);
        sendJson(res, req, 202, { ok: true });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/relay') {
      const body = await readJson(req);
      const targetUrl = validateHttpUrl(body.url);
      const method = String(body.method || 'GET').toUpperCase();
      const headers = sanitizeRelayHeaders(body.headers || {});
      const started = performance.now();

      const response = await fetch(targetUrl, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body.body
      });

      const text = await response.text();

      sendJson(res, req, 200, {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
        latencyMs: Math.round(performance.now() - started)
      });
      return;
    }

    sendJson(res, req, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, req, 400, { error: error.message || String(error) });
  }
}

/* ----------------------------- static/ws ----------------------------- */

async function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;

  filePath = decodeURIComponent(filePath).replace(/\0/g, '');

  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));
  const rel = path.relative(PUBLIC_DIR, fullPath);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    sendText(res, req, 403, 'Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml'
      }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });

    res.end(data);
  } catch {
    sendText(res, req, 404, 'Not found');
  }
}

function handleUpgrade(req, socket) {
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];

  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n')
  );

  clients.add(socket);
  wsSend(socket, JSON.stringify({ type: 'state', state: publicState() }));

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  socket.on('data', buffer => {
    if ((buffer[0] & 0x0f) === 8) {
      clients.delete(socket);
      socket.end();
    }
  });
}

function wsSend(socket, text) {
  if (socket.destroyed) return;

  const payload = Buffer.from(text);
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.on('upgrade', handleUpgrade);

await loadState();

startScheduler();

server.listen(PORT, HOST, () => {
  log('info', `LLM Monitor backend: http://${HOST}:${PORT}`);
  log('info', 'Proxy source:', PROXY_SOURCE);
  log('info', 'CORS relay endpoint: POST /api/relay');
});