import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';

export interface ProxyStyleOptions {
  opacity: number;
  hideScrollbar: boolean;
}

const UPSTREAM_HOST = 'weread.qq.com';
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;

const STRIPPED_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
]);

export function rewriteSetCookie(cookie: string): string {
  return cookie
    .replace(/;\s*Domain=[^;]*/gi, '')
    .replace(/;\s*Secure\b/gi, '')
    .replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
}

export function rewriteResponseHeaders(
  headers: http.IncomingHttpHeaders,
  localOrigin: string,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};

  for (const [rawKey, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    const key = rawKey.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(key)) {
      continue;
    }
    if (key === 'set-cookie') {
      const list = Array.isArray(value) ? value : [value];
      out['set-cookie'] = list.map(rewriteSetCookie);
      continue;
    }
    if (key === 'location' && typeof value === 'string') {
      if (value.startsWith(UPSTREAM_ORIGIN)) {
        out.location = localOrigin + value.slice(UPSTREAM_ORIGIN.length);
      } else if (value.startsWith(`http://${UPSTREAM_HOST}`)) {
        out.location = localOrigin + value.slice(`http://${UPSTREAM_HOST}`.length);
      } else {
        out.location = value;
      }
      continue;
    }
    out[key] = value;
  }

  return out;
}

export function buildInjectedStyleTag(options: ProxyStyleOptions): string {
  const clampedOpacity = Math.max(0.15, Math.min(1, Number(options.opacity) || 1));
  const scrollbarCss = options.hideScrollbar
    ? `
html, body, * {
  scrollbar-width: none !important;
}
::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}`
    : '';

  return `<style id="wxds-custom-style">
html {
  opacity: ${clampedOpacity} !important;
  transition: opacity 0.15s ease;
}
${scrollbarCss}
</style>`;
}

export function injectCustomStyle(html: string, options: ProxyStyleOptions): string {
  const tag = buildInjectedStyleTag(options);
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tag}</head>`);
  }
  return `${tag}${html}`;
}

export function toLocalProxyUrl(targetUrl: string | undefined, localOrigin: string): string {
  if (!targetUrl) {
    return `${localOrigin}/`;
  }
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname === UPSTREAM_HOST) {
      return `${localOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Fallback to root if malformed URL
  }
  return `${localOrigin}/`;
}

function decompressBody(buffer: Buffer, encoding?: string): Buffer {
  const enc = (encoding || '').toLowerCase().trim();
  try {
    if (enc === 'gzip') {
      return zlib.gunzipSync(buffer);
    }
    if (enc === 'br') {
      return zlib.brotliDecompressSync(buffer);
    }
    if (enc === 'deflate') {
      return zlib.inflateSync(buffer);
    }
  } catch {
    return buffer;
  }
  return buffer;
}

export class WeReadProxyServer {
  private server: http.Server | undefined;
  private port = 0;
  private styleOptions: ProxyStyleOptions;

  constructor(options: ProxyStyleOptions) {
    this.styleOptions = { ...options };
  }

  updateOptions(options: ProxyStyleOptions): void {
    this.styleOptions = { ...options };
  }

  getPort(): number {
    return this.port;
  }

  getLocalOrigin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureStarted(preferredPort = 0): Promise<number> {
    if (this.server && this.port > 0) {
      return this.port;
    }

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    const listen = (port: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const onError = (err: Error) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            resolve(addr.port);
          } else {
            reject(new Error('Failed to resolve proxy listening port'));
          }
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });

    try {
      this.port = await listen(preferredPort);
    } catch {
      if (preferredPort !== 0) {
        this.port = await listen(0);
      } else {
        throw new Error('无法启动本地微信读书代理服务');
      }
    }

    this.server = server;
    return this.port;
  }

  private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const reqPath = clientReq.url || '/';
    const localOrigin = this.getLocalOrigin();

    const forwardHeaders: http.OutgoingHttpHeaders = {};
    for (const [rawKey, value] of Object.entries(clientReq.headers)) {
      if (value === undefined) {
        continue;
      }
      const key = rawKey.toLowerCase();
      if (key === 'host' || key === 'connection') {
        continue;
      }
      if (key === 'origin' && typeof value === 'string') {
        forwardHeaders.origin = UPSTREAM_ORIGIN;
        continue;
      }
      if (key === 'referer' && typeof value === 'string') {
        forwardHeaders.referer = value.startsWith(localOrigin)
          ? UPSTREAM_ORIGIN + value.slice(localOrigin.length)
          : UPSTREAM_ORIGIN + '/';
        continue;
      }
      forwardHeaders[key] = value;
    }
    forwardHeaders.host = UPSTREAM_HOST;

    const upstreamReq = https.request(
      {
        hostname: UPSTREAM_HOST,
        port: 443,
        path: reqPath,
        method: clientReq.method || 'GET',
        headers: forwardHeaders,
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode || 200;
        const contentType = String(upstreamRes.headers['content-type'] || '');
        const rewrittenHeaders = rewriteResponseHeaders(upstreamRes.headers, localOrigin);

        if (contentType.includes('text/html')) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            const rawBuf = Buffer.concat(chunks);
            const plainBuf = decompressBody(
              rawBuf,
              String(upstreamRes.headers['content-encoding'] || ''),
            );
            const html = injectCustomStyle(plainBuf.toString('utf8'), this.styleOptions);
            const outBuf = Buffer.from(html, 'utf8');

            delete rewrittenHeaders['content-encoding'];
            delete rewrittenHeaders['transfer-encoding'];
            rewrittenHeaders['content-length'] = outBuf.byteLength;

            clientRes.writeHead(statusCode, rewrittenHeaders);
            clientRes.end(outBuf);
          });
        } else {
          clientRes.writeHead(statusCode, rewrittenHeaders);
          upstreamRes.pipe(clientRes);
        }
      },
    );

    upstreamReq.on('error', (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      clientRes.end(
        `<html><body style="font-family:sans-serif;padding:24px;color:#ccc;background:#1e1e1e">
          <h3>微信读书代理连接失败</h3>
          <p>${err.message}</p>
          <p>请检查网络连接，或使用顶部「在浏览器中打开阅读」按钮。</p>
        </body></html>`,
      );
    });

    clientReq.pipe(upstreamReq);
  }

  dispose(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
      this.port = 0;
    }
  }
}
