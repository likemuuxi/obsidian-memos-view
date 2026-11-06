/**
 * 扫码登录弹窗：申请二维码 → 长轮询扫码状态 → 处理验证码 / IDC 重定向 / 过期重取。
 */

import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";
import { toCanvas } from "qrcode";
import { isZhLocale } from "../i18n";
import { fetchBotQrcode, pollQrcodeStatus } from "./ilink";

export interface QrLoginSuccess {
	botToken: string;
	baseUrl: string;
}

function tr(zh: string, en: string): string {
	return isZhLocale() ? zh : en;
}

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

export class WechatQrLoginModal extends Modal {
	private readonly abort = new AbortController();
	private statusEl!: HTMLElement;
	private canvas!: HTMLCanvasElement;
	private verifyContainer!: HTMLElement;
	private verifyInput!: HTMLInputElement;
	private verifyBuilt = false;
	private verifyCode = "";
	private pollBase: string | undefined;
	private finished = false;

	constructor(
		app: App,
		private clientVersion: string,
		private existingToken: string,
		private onSuccess: (result: QrLoginSuccess) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(tr("微信扫码登录", "WeChat QR login"));
		this.contentEl.empty();

		this.statusEl = this.contentEl.createEl("p");
		this.statusEl.style.textAlign = "center";
		this.statusEl.style.marginBottom = "0.75em";

		const holder = this.contentEl.createDiv();
		holder.style.display = "flex";
		holder.style.justifyContent = "center";
		this.canvas = holder.createEl("canvas");

		this.verifyContainer = this.contentEl.createDiv();
		this.verifyContainer.hide();

		const hint = this.contentEl.createEl("p");
		hint.style.textAlign = "center";
		hint.addClass("mod-muted");
		hint.setText(
			tr(
				"打开微信扫一扫，扫描二维码并在手机上确认",
				"Open WeChat, scan the QR code and confirm on your phone",
			),
		);

		void this.run();
	}

	onClose(): void {
		this.abort.abort();
	}

	private setStatus(text: string): void {
		this.statusEl.setText(text);
	}

	private async run(): Promise<void> {
		try {
			while (!this.abort.signal.aborted && !this.finished) {
				await this.oneRound();
				if (!this.finished && !this.abort.signal.aborted) {
					// 二维码过期或获取失败后，稍候重新申请
					await sleep(2_000, this.abort.signal);
				}
			}
		} catch (err) {
		if (!this.abort.signal.aborted) {
			console.error("[wechat] qr login failed:", err);
			const detail = err instanceof Error ? err.message : String(err);
			this.setStatus(
				tr(`登录过程出错：${detail}`, `Login error: ${detail}`),
			);
		}
	}
	}

	/** 一轮：申请二维码并轮询到过期/成功为止。 */
	private async oneRound(): Promise<void> {
		this.setStatus(tr("正在获取二维码…", "Fetching QR code…"));
		const qr = await fetchBotQrcode(
			this.clientVersion,
			this.existingToken ? [this.existingToken] : [],
		);
		if (this.abort.signal.aborted) {
			return;
		}
		await toCanvas(this.canvas, qr.qrcode_img_content, { width: 220, margin: 2 });
		this.setStatus(tr("请使用微信扫一扫", "Scan with WeChat"));
		this.pollBase = undefined;
		this.verifyCode = "";
		this.verifyContainer.hide();

		while (!this.abort.signal.aborted && !this.finished) {
			const resp = await pollQrcodeStatus(this.clientVersion, qr.qrcode, {
				baseUrl: this.pollBase,
				verifyCode: this.verifyCode || undefined,
				signal: this.abort.signal,
			});

			switch (resp.status) {
				case "wait":
					break;
				case "scaned":
					this.setStatus(tr("已扫码，请在手机上确认", "Scanned, confirm on your phone"));
					break;
				case "scaned_but_redirect":
					if (resp.redirect_host) {
						this.pollBase = `https://${resp.redirect_host}`;
					}
					break;
				case "need_verifycode":
					this.showVerifyInput();
					break;
				case "verify_code_blocked":
					this.verifyCode = "";
					this.verifyContainer.hide();
					this.setStatus(
						tr("验证码尝试过于频繁，请稍后重新扫码", "Too many verify attempts, rescan later"),
					);
					break;
				case "expired":
					this.setStatus(tr("二维码已过期，正在刷新…", "QR code expired, refreshing…"));
					return;
				case "confirmed":
				case "binded_redirect": {
					const token = (resp.bot_token ?? this.existingToken).trim();
					if (!token) {
						this.setStatus(tr("登录失败：未获取到凭证", "Login failed: no token returned"));
						return;
					}
					this.finished = true;
					this.setStatus(tr("登录成功", "Logged in"));
					this.onSuccess({ botToken: token, baseUrl: (resp.baseurl ?? "").trim() });
					this.close();
					return;
				}
			}
		}
	}

	private showVerifyInput(): void {
		if (!this.verifyBuilt) {
			this.verifyBuilt = true;
			new Setting(this.verifyContainer)
				.setName(tr("验证码", "Verify code"))
				.addText((text) => {
					this.verifyInput = text.inputEl;
				})
				.addButton((button) => {
					button.setButtonText(tr("提交", "Submit"));
					button.onClick(() => this.submitVerifyCode());
				});
		}
		this.setStatus(tr("需要验证码，请输入后提交", "Verify code required"));
		this.verifyContainer.show();
		this.verifyInput?.focus();
	}

	private submitVerifyCode(): void {
		const code = this.verifyInput.value.trim();
		if (!code) {
			return;
		}
		this.verifyCode = code;
		this.verifyContainer.hide();
		this.setStatus(tr("正在验证…", "Verifying…"));
	}
}
