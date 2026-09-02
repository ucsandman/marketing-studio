import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * Secured localhost HTTP server for `launch ui`. Three guards protect every
 * /api/* request, because this server can later publish content and spend:
 *  1. binds 127.0.0.1 only (never 0.0.0.0),
 *  2. rejects non-localhost Host headers (DNS-rebinding guard),
 *  3. requires a per-run random token on every API call.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// Works from both src/ui (vitest) and dist/ui (built): two levels up is the repo root.
const PKG = JSON.parse(readFileSync(join(MODULE_DIR, '..', '..', 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

const BODY_LIMIT_BYTES = 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>launch ui</title></head>
<body style="font-family: system-ui; background: #111; color: #eee; padding: 4rem;">
<h1>UI bundle missing</h1>
<p>The dashboard frontend has not been built yet. Run <code>npm run build</code> in the launch-engine repo, then restart <code>launch ui</code>.</p>
</body></html>`;

export interface FieldError {
  field: string;
  message: string;
}

export type ApiEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; error: string; fields?: FieldError[] };

export interface UiResponse {
  status: number;
  body: ApiEnvelope;
}

export function jsonOk(data: unknown): UiResponse {
  return { status: 200, body: { ok: true, data } };
}

export function jsonErr(status: number, message: string, fields?: FieldError[]): UiResponse {
  return { status, body: { ok: false, error: message, ...(fields ? { fields } : {}) } };
}

export interface UiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type UiHandler = (req: UiRequest) => Promise<UiResponse> | UiResponse;

export interface UiServerOptions {
  /** 0 = ephemeral (tests). Default 4400. */
  port?: number;
  /** Defaults to dist/ui next to the built CLI. */
  webRoot?: string;
  /** Injected by tests; otherwise a fresh random token per run. */
  token?: string;
}

export interface UiServer {
  server: Server;
  token: string;
  readonly port: number;
  /** Tokenized URL to open in the browser. */
  readonly url: string;
  route(method: string, pattern: string, handler: UiHandler): void;
  /** Every registered route — lets tests prove 100% guard coverage. */
  registeredRoutes(): { method: string; pattern: string }[];
  listen(): Promise<void>;
  close(): Promise<void>;
}

interface Route {
  method: string;
  segments: string[];
  handler: UiHandler;
}

/** Throw from a route handler to produce a structured non-500 error response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: FieldError[],
  ) {
    super(message);
  }
}

export function createUiServer(options: UiServerOptions = {}): UiServer {
  const token = options.token ?? randomBytes(24).toString('hex');
  const webRoot = resolve(options.webRoot ?? join(MODULE_DIR, '..', '..', 'dist', 'ui'));
  const requestedPort = options.port ?? 4400;
  const routes: Route[] = [];

  function route(method: string, pattern: string, handler: UiHandler): void {
    routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
  }

  route('GET', '/api/health', () => jsonOk({ name: PKG.name, version: PKG.version }));

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      sendJson(res, jsonErr(500, oneLine(err)));
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (rawPath === '/api' || rawPath.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      await handleStatic(req, res, rawPath);
    }
  }

  function hostAllowed(req: IncomingMessage): boolean {
    const host = req.headers.host;
    if (!host) return false;
    const name = host.replace(/:\d+$/, '');
    return name === 'localhost' || name === '127.0.0.1';
  }

  function tokenValid(req: IncomingMessage): boolean {
    const headerValue = req.headers['x-launch-token'];
    const auth = req.headers.authorization;
    const presented =
      typeof headerValue === 'string'
        ? headerValue
        : auth?.startsWith('Bearer ')
          ? auth.slice('Bearer '.length)
          : undefined;
    if (!presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req)) {
      return sendJson(res, jsonErr(403, 'Forbidden: requests must come from localhost'));
    }
    if (!tokenValid(req)) {
      return sendJson(res, jsonErr(403, 'Forbidden: missing or invalid launch token'));
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const matched = matchRoute(routes, req.method ?? 'GET', url.pathname);
    if (!matched) {
      return sendJson(res, jsonErr(404, `No such endpoint: ${req.method} ${url.pathname}`));
    }

    try {
      const body = await readJsonBody(req);
      const response = await matched.handler({
        method: req.method ?? 'GET',
        path: url.pathname,
        params: matched.params,
        query: url.searchParams,
        body,
      });
      sendJson(res, response);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, jsonErr(err.status, err.message, err.fields));
      }
      sendJson(res, jsonErr(500, oneLine(err)));
    }
  }

  async function handleStatic(
    req: IncomingMessage,
    res: ServerResponse,
    rawPath: string,
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 404, 'Not found');
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      return sendText(res, 404, 'Not found');
    }
    if (pathname.includes('\0')) {
      return sendText(res, 404, 'Not found');
    }

    if (!existsSync(webRoot)) {
      // UI not built yet: a small inline page instead of a confusing 404.
      if (extname(pathname) === '') return sendHtml(res, PLACEHOLDER_HTML);
      return sendText(res, 404, 'Not found');
    }

    // Traversal guard: the resolved path must stay inside webRoot.
    const fsPath = resolve(webRoot, '.' + pathname);
    const rel = relative(webRoot, fsPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return sendText(res, 404, 'Not found');
    }

    if (await isFile(fsPath)) {
      return sendFile(res, fsPath);
    }
    if (extname(pathname) === '') {
      const index = join(webRoot, 'index.html');
      if (await isFile(index)) return sendFile(res, index);
      return sendHtml(res, PLACEHOLDER_HTML);
    }
    sendText(res, 404, 'Not found');
  }

  function listen(): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolvePromise();
      });
    });
  }

  function close(): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      server.close((err) => (err ? reject(err) : resolvePromise()));
      server.closeAllConnections();
    });
  }

  return {
    server,
    token,
    get port() {
      return (server.address() as AddressInfo).port;
    },
    get url() {
      return `http://127.0.0.1:${this.port}/?token=${token}`;
    },
    route,
    registeredRoutes: () =>
      routes.map((r) => ({ method: r.method, pattern: '/' + r.segments.join('/') })),
    listen,
    close,
  };
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchRoute(
  routes: Route[],
  method: string,
  pathname: string,
): { handler: UiHandler; params: Record<string, string> } | undefined {
  const parts = splitPath(pathname);
  for (const candidate of routes) {
    if (candidate.method !== method.toUpperCase() || candidate.segments.length !== parts.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matches = true;
    for (let i = 0; i < parts.length; i++) {
      const segment = candidate.segments[i] ?? '';
      const part = parts[i] ?? '';
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(part);
      } else if (segment !== part) {
        matches = false;
        break;
      }
    }
    if (matches) return { handler: candidate.handler, params };
  }
  return undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new HttpError(413, 'Request body too large (1MB limit)');
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0] ?? 'Internal error';
}

function sendJson(res: ServerResponse, response: UiResponse): void {
  if (res.writableEnded) return;
  res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(response.body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function sendFile(res: ServerResponse, path: string): Promise<void> {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const content = await readFile(path);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}
