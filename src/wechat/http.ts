/**
 * 基于 Node https 的直连 HTTP 传输层。
 *
 * 为什么不用 Obsidian requestUrl：requestUrl 强制走系统代理，而 iLink
 * 需要直连；Node https 不读取系统/环境代理，正好满足要求。
 *
 * 所有 Node 模块均为懒加载 require：本模块仅在桌面端被调用，
 * 移动端 bundle 加载时不会触发 require，避免崩溃。
 */

type NodeHttpsModule = typeof import("https");

let httpsModule: NodeHttpsModule | null = null;

function getHttps(): NodeHttpsModule {
	if (!httpsModule) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		httpsModule = require("https") as NodeHttpsModule;
	}
	return httpsModule;
}

/** 是否可用 Node 传输（仅桌面端 Electron）。 */
export function isNodeTransportAvailable(): boolean {
	return typeof process !== "undefined" && Boolean(process.versions?.node);
}

export interface HttpResponse {
	status: number;
	body: Buffer;
}

export class HttpTimeoutError extends Error {
	constructor(message = "request timeout") {
		super(message);
		this.name = "HttpTimeoutError";
	}
}

export interface HttpRequestOptions {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string | Buffer;
	timeoutMs?: number;
	signal?: AbortSignal;
	followRedirects?: number;
}

/** 发送 https 请求（直连，不经过代理），支持 3xx 跳转跟随。 */
export function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
	const https = getHttps();
	const timeoutMs = options.timeoutMs ?? 15_000;
	const redirectsLeft = options.followRedirects ?? 5;

	return new Promise<HttpResponse>((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(new DOMException("aborted", "AbortError"));
			return;
		}

		let settled = false;
		const url = new URL(options.url);
		// 统一转 Buffer：便于计算字节长度
		const bodyBytes =
			options.body === undefined
				? null
				: Buffer.isBuffer(options.body)
					? options.body
					: Buffer.from(options.body, "utf-8");
		const req = https.request(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || (url.protocol === "http:" ? 80 : 443),
				path: `${url.pathname}${url.search}`,
				method: options.method ?? "GET",
			headers: {
				// Node https 不会自动解压；明确要求不压缩，避免收到 gzip 无法解析
				"Accept-Encoding": "identity",
				// 不显式设置时 Node 会用 Transfer-Encoding: chunked，
				// 腾讯网关对 chunked POST 返回 412（实测确认）
				...(bodyBytes ? { "Content-Length": String(bodyBytes.length) } : {}),
				...(options.headers ?? {}),
			},
		},
			(res) => {
				const status = res.statusCode ?? 0;
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					if (settled) {
						return;
					}
					settled = true;
					const body = Buffer.concat(chunks);
					const location = res.headers.location;
					if (
						status >= 300 &&
						status < 400 &&
						location &&
						redirectsLeft > 0
					) {
						const nextUrl = new URL(location, url).toString();
						httpRequest({ ...options, url: nextUrl, followRedirects: redirectsLeft - 1 })
							.then(resolve, reject);
						return;
					}
					resolve({ status, body });
				});
				res.on("error", (err) => {
					if (!settled) {
						settled = true;
						reject(err);
					}
				});
			},
		);

		req.on("error", (err) => {
			if (settled) {
				return;
			}
			settled = true;
			reject(err);
		});

		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			req.destroy(new HttpTimeoutError());
			reject(new HttpTimeoutError(`request timeout after ${timeoutMs}ms`));
		}, timeoutMs);

		const onAbort = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			req.destroy(new DOMException("aborted", "AbortError"));
			reject(new DOMException("aborted", "AbortError"));
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		req.on("close", () => clearTimeout(timer));

		if (bodyBytes) {
			req.write(bodyBytes);
		}
		req.end();
	});
}

/** 按 HTML meta charset 解码响应体（中文站点常见 GBK），兜底 UTF-8。 */
function decodeHtmlBody(body: Buffer): string {
	const head = body.subarray(0, 4096).toString("latin1");
	const charset = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
	if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset)) {
		try {
			return new TextDecoder(charset).decode(body);
		} catch {
			// 未知编码：回退 UTF-8
		}
	}
	return body.toString("utf-8");
}

/** GET 文本响应。 */
export async function httpGetText(
	url: string,
	options: Omit<HttpRequestOptions, "url" | "method" | "body"> = {},
): Promise<{ status: number; text: string }> {
	const res = await httpRequest({ ...options, url, method: "GET" });
	return { status: res.status, text: decodeHtmlBody(res.body) };
}

/** GET 二进制响应。 */
export async function httpGetBuffer(
	url: string,
	options: Omit<HttpRequestOptions, "url" | "method" | "body"> = {},
): Promise<Buffer> {
	const res = await httpRequest({ ...options, url, method: "GET" });
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`GET ${url} failed: ${res.status}`);
	}
	return res.body;
}

/** POST JSON，返回解析后的 JSON（HTTP 非 2xx 抛错并附带响应体）。 */
export async function httpPostJson<T>(
	url: string,
	body: unknown,
	options: Omit<HttpRequestOptions, "url" | "method" | "body"> = {},
): Promise<T> {
	const payload = JSON.stringify(body);
	const res = await httpRequest({
		...options,
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
		body: payload,
	});
	const text = res.body.toString("utf-8");
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`POST ${url} failed: ${res.status} ${text.slice(0, 500)}`);
	}
	return JSON.parse(text) as T;
}
