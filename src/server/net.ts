/**
 * Единственное место, где сервер ходит по чужому адресу.
 *
 * Эндпоинт, который скачивает страницу по ссылке пользователя, — это подарочный
 * SSRF, если его не запереть: адрес приходит снаружи, а ходит по нему процесс,
 * которому изнутри облака видны метаданные инстанса, соседние сервисы и вся
 * приватная сеть. Поэтому здесь запрет по белому списку схем и чёрному списку
 * адресов, свой обход редиректов и потолки на время и на байты (SPEC §10).
 *
 * Почему не `fetch`. Проверить адрес и потом позвать `fetch` по имени хоста —
 * защита с дырой: между проверкой и соединением имя резолвится второй раз, и
 * во второй раз оно может указать куда угодно (DNS rebinding). Здесь вместо
 * этого подменяется сам резолвер соединения (`lookup` у node:http): адрес
 * проверяется ровно тот, к которому сокет и подключится, а не похожий на него.
 * Ценой ручного обхода редиректов — зато каждый прыжок проверяется так же, как
 * первый.
 */
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export const NET_LIMITS = {
  /** Таймаут одного запроса. Столько же, сколько в §10 — и влезает в Hobby. */
  timeoutMs: 8_000,
  /** Потолок ответа. Статья, которая не уложилась в пять мегабайт, — не статья. */
  maxBytes: 5 * 1024 * 1024,
  /** Картинка вырезки. Больше — не иллюстрация, а обои. */
  maxImageBytes: 1_500_000,
  redirects: 3,
} as const;

export class NetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Адреса, по которым публичный эндпоинт ходить не имеет права.
 *
 * Список длиннее очевидного: кроме приватных сетей RFC 1918 здесь loopback,
 * link-local (в облаках по 169.254.169.254 лежат метаданные инстанса — то, ради
 * чего SSRF обычно и затевают), CGNAT, тестовые диапазоны и всё, что не
 * маршрутизируется в интернете.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip.toLowerCase());
  return true;
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && p[2] <= 2) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast и зарезервированное, включая 255.255.255.255
  return false;
}

function isBlockedV6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;

  // ::ffff:10.0.0.1 — тот же приватный адрес, только надевший шляпу.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (ip.startsWith('64:ff9b:')) return true; // NAT64

  const head = parseInt(ip.split(':')[0] || '0', 16);
  if ((head & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((head & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((head & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Резолвер соединения: наружу отдаёт только те адреса, что прошли проверку.
 *
 * Возвращать «первый безопасный» мало — сокет должен получить именно этот
 * список, иначе Node возьмёт для соединения свой, полученный обычным путём.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0);
      return;
    }

    const safe = addresses.filter((a) => !isBlockedAddress(a.address));
    if (safe.length === 0) {
      callback(new NetError('blocked-address', `${hostname} resolves to a private address`), '', 0);
      return;
    }

    if (options.all) (callback as (e: null, a: typeof safe) => void)(null, safe);
    else callback(null, safe[0].address, safe[0].family);
  });
};

export interface FetchResult {
  /** Адрес после редиректов: канонический источник вырезки — он. */
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface FetchOptions {
  maxBytes?: number;
  accept?: string;
  timeoutMs?: number;
}

/** Проверка адреса до всякой сети: схема, форма и литеральный IP в хосте. */
export function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NetError('bad-url', 'That does not look like a link.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NetError('bad-scheme', `Only http and https links can be unfurled, not ${url.protocol}`);
  }

  // Адрес, записанный числом, минует DNS — и проверку резолвера вместе с ним.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) {
    throw new NetError('blocked-address', 'That address is not reachable from here.');
  }
  return url;
}

export async function safeFetch(input: string, options: FetchOptions = {}): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? NET_LIMITS.maxBytes;
  const deadline = Date.now() + (options.timeoutMs ?? NET_LIMITS.timeoutMs);

  let url = parseTarget(input);

  for (let hop = 0; hop <= NET_LIMITS.redirects; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new NetError('timeout', 'The source took too long to answer.');

    const response = await once(url, options.accept ?? '*/*', left, maxBytes);

    if (response.location && response.status >= 300 && response.status < 400) {
      // Каждый прыжок проверяется заново: редирект на 169.254.169.254 — самый
      // дешёвый способ обойти проверку, сделанную один раз на входе.
      url = parseTarget(new URL(response.location, url).toString());
      continue;
    }

    if (response.status >= 400) {
      throw new NetError('http-error', `The source answered ${response.status}.`);
    }

    return {
      url: url.toString(),
      status: response.status,
      contentType: response.contentType,
      body: response.body,
    };
  }

  throw new NetError('too-many-redirects', 'The link bounces through too many redirects.');
}

interface Hop {
  status: number;
  contentType: string;
  location?: string;
  body: Buffer;
}

function once(url: URL, accept: string, timeoutMs: number, maxBytes: number): Promise<Hop> {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise<Hop>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        headers: {
          // Представляемся честно: скрывать, что это робот, незачем, а по
          // user-agent сайты выбирают, что отдавать.
          'user-agent': 'r3ad/0.1 (+https://github.com/egorb2302/r3ad) unfurl',
          accept,
          'accept-language': 'en,ru;q=0.8',
          // Сжатие выключено намеренно: потолок в байтах должен считаться по
          // тому, что реально приедет, а не по размеру архива.
          'accept-encoding': 'identity',
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new NetError('too-large', 'The source is larger than 5 MB.'));
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: (response.headers['content-type'] ?? '').toString(),
            location: response.headers.location,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );

    request.on('timeout', () =>
      request.destroy(new NetError('timeout', 'The source took too long to answer.')),
    );
    request.on('error', (err) =>
      reject(err instanceof NetError ? err : new NetError('unreachable', describe(err))),
    );
    request.end();
  });
}

function describe(err: unknown): string {
  const code = (err as { code?: string }).code;
  if (code === 'ENOTFOUND') return 'No such host.';
  if (code === 'ECONNREFUSED') return 'The host refused the connection.';
  if (code === 'CERT_HAS_EXPIRED') return 'The certificate of that host has expired.';
  return err instanceof Error ? err.message : String(err);
}
