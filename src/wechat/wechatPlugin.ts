/**
 * 微信集成编排器：管理长轮询循环、同步游标持久化、登录/登出生命周期。
 * 由 main.ts 持有一个实例。
 */

import { Notice } from "obsidian";
import type MemosViewPlugin from "../main";
import { t } from "../i18n";
import { WechatAgent } from "./agent";
import { isNodeTransportAvailable } from "./http";
import {
	DEFAULT_API_BASE_URL,
	SESSION_PAUSE_MS,
	STALE_TOKEN_ERRCODE,
	getUpdates,
	notifyStop,
	sendTextMessage,
} from "./ilink";
import { WechatQrLoginModal } from "./qrLoginModal";
import type { WeixinMessage } from "./types";

const STATE_FILE = "wechat-state.json";
const RETRY_DELAY_MS = 5_000;
const PAUSE_POLL_MS = 30_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(finish, ms);
		function finish() {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		}
		signal.addEventListener("abort", finish, { once: true });
	});
}

export class WechatIntegration {
	private abort: AbortController | null = null;
	private running = false;
	private pausedUntil = 0;
	private getUpdatesBuf = "";
	private staleNoticeAt = 0;

	constructor(private plugin: MemosViewPlugin) {}

	get isRunning(): boolean {
		return this.running;
	}

	private get wechat() {
		return this.plugin.settings.wechat;
	}

	private get clientOptions() {
		return {
			baseUrl: this.wechat.baseUrl.trim() || DEFAULT_API_BASE_URL,
			botToken: this.wechat.botToken,
			clientVersion: this.plugin.manifest.version,
		};
	}

	/** 启动接收循环；未登录时先弹扫码登录。 */
	async start(): Promise<void> {
		if (this.running) {
			return;
		}
		if (!isNodeTransportAvailable()) {
			new Notice(t("notices.wechatDesktopOnly"));
			return;
		}
		if (!this.wechat.botToken.trim()) {
			this.openLogin();
			return;
		}

		this.running = true;
		await this.loadState();
		this.abort = new AbortController();
		new Notice(t("notices.wechatStarted"));
		void this.loop();
	}

	async stop(options: { notify?: boolean } = {}): Promise<void> {
		this.running = false;
		this.abort?.abort();
		this.abort = null;
		if (options.notify && isNodeTransportAvailable() && this.wechat.botToken.trim()) {
			await notifyStop(this.clientOptions).catch(() => undefined);
		}
	}

	/** 打开扫码登录弹窗；成功后保存凭证并启动。 */
	openLogin(): void {
		if (!isNodeTransportAvailable()) {
			new Notice(t("notices.wechatDesktopOnly"));
			return;
		}
		new WechatQrLoginModal(
			this.plugin.app,
			this.plugin.manifest.version,
			this.wechat.botToken,
			async (result) => {
				this.wechat.botToken = result.botToken;
				this.wechat.baseUrl = result.baseUrl;
				this.getUpdatesBuf = "";
				await this.clearState();
				await this.plugin.saveSettings();
				this.plugin.refreshSettingTab();
				new Notice(t("notices.wechatLoginSuccess"));
				await this.start();
			},
		).open();
	}

	/** 登出：停止接收、清凭证与游标。 */
	async logout(): Promise<void> {
		await this.stop({ notify: true });
		this.wechat.botToken = "";
		this.wechat.baseUrl = "";
		this.getUpdatesBuf = "";
		await this.clearState();
		await this.plugin.saveSettings();
		this.plugin.refreshSettingTab();
		new Notice(t("notices.wechatLoggedOut"));
	}

	private async loop(): Promise<void> {
		const signal = this.abort?.signal;
		if (!signal) {
			return;
		}
		const agent = new WechatAgent({ plugin: this.plugin, wechat: this.wechat });

		while (this.running && !signal.aborted) {
			if (Date.now() < this.pausedUntil) {
				await sleep(PAUSE_POLL_MS, signal);
				continue;
			}

			let resp;
			try {
				resp = await getUpdates({
					...this.clientOptions,
					getUpdatesBuf: this.getUpdatesBuf,
					signal,
				});
			} catch (err) {
				if (!this.running || signal.aborted) {
					break;
				}
				console.warn("[wechat] getupdates failed, retrying:", err);
				await sleep(RETRY_DELAY_MS, signal);
				continue;
			}

			if (resp.errcode === STALE_TOKEN_ERRCODE) {
				this.pausedUntil = Date.now() + SESSION_PAUSE_MS;
				if (Date.now() - this.staleNoticeAt > SESSION_PAUSE_MS) {
					this.staleNoticeAt = Date.now();
					new Notice(t("notices.wechatTokenStale"));
				}
				continue;
			}
			if (resp.ret !== undefined && resp.ret !== 0) {
				console.warn(`[wechat] getupdates ret=${resp.ret} ${resp.errmsg ?? ""}`);
				await sleep(RETRY_DELAY_MS, signal);
				continue;
			}

			if (typeof resp.get_updates_buf === "string" && resp.get_updates_buf) {
				this.getUpdatesBuf = resp.get_updates_buf;
				void this.persistState();
			}

			for (const msg of resp.msgs ?? []) {
				if (!this.running || signal.aborted) {
					break;
				}
				await this.dispatch(msg, agent);
			}
		}
	}

	private async dispatch(msg: WeixinMessage, agent: WechatAgent): Promise<void> {
		try {
			const reply = await agent.handle(msg);
			if (!reply || !msg.from_user_id) {
				return;
			}
			await sendTextMessage({
				...this.clientOptions,
				to: msg.from_user_id,
				text: reply,
				contextToken: msg.context_token,
				signal: this.abort?.signal,
			});
		} catch (err) {
			console.error("[wechat] dispatch message failed:", err);
		}
	}

	private statePath(): string {
		const dir = this.plugin.manifest.dir ?? "";
		return dir ? `${dir}/${STATE_FILE}` : STATE_FILE;
	}

	private async loadState(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (await adapter.exists(this.statePath())) {
				const parsed = JSON.parse(await adapter.read(this.statePath())) as {
					getUpdatesBuf?: string;
				};
				this.getUpdatesBuf = parsed.getUpdatesBuf ?? "";
			}
		} catch (err) {
			console.warn("[wechat] load state failed:", err);
		}
	}

	private async persistState(): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(
				this.statePath(),
				JSON.stringify({ getUpdatesBuf: this.getUpdatesBuf }),
			);
		} catch (err) {
			console.warn("[wechat] persist state failed:", err);
		}
	}

	private async clearState(): Promise<void> {
		this.getUpdatesBuf = "";
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (await adapter.exists(this.statePath())) {
				await adapter.remove(this.statePath());
			}
		} catch (err) {
			console.warn("[wechat] clear state failed:", err);
		}
	}
}
