/**
 * Composer 语音录制控制器：getUserMedia + MediaRecorder。
 *
 * 桌面 Electron 录 audio/webm（opus）；iOS WebView 录 audio/mp4。
 * 运行时不支持或权限被拒由调用方通过异常提示用户。
 */

/** 探测当前环境可用的录音容器，返回 [mimeType, 扩展名]；不支持返回 null。 */
export function pickRecordingFormat(): { mimeType: string; ext: string } | null {
	if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		return null;
	}
	if (MediaRecorder.isTypeSupported("audio/webm")) {
		return { mimeType: "audio/webm", ext: "webm" };
	}
	if (MediaRecorder.isTypeSupported("audio/mp4")) {
		return { mimeType: "audio/mp4", ext: "m4a" };
	}
	return null;
}

export class VoiceRecorder {
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private stoppedAt = 0;

	get isRecording(): boolean {
		return this.recorder?.state === "recording";
	}

	get elapsedMs(): number {
		return this.stoppedAt ? this.stoppedAt - this.startedAt : Date.now() - this.startedAt;
	}

	private startedAt = 0;

	async start(): Promise<void> {
		const format = pickRecordingFormat();
		if (!format) {
			throw new Error("unsupported");
		}
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.chunks = [];
		this.recorder = new MediaRecorder(this.stream, { mimeType: format.mimeType });
		this.recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				this.chunks.push(event.data);
			}
		};
		this.startedAt = Date.now();
		this.stoppedAt = 0;
		this.recorder.start(500);
	}

	/** 停止录音并返回完整音频数据；未在录音或无数据返回 null。 */
	async stop(): Promise<{ buffer: ArrayBuffer; ext: string } | null> {
		const recorder = this.recorder;
		if (!recorder || recorder.state === "inactive") {
			this.cleanup();
			return null;
		}
		this.stoppedAt = Date.now();
		const blob = await new Promise<Blob>((resolve) => {
			recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
			recorder.stop();
		});
		this.cleanup();
		if (!blob.size) {
			return null;
		}
		const format = pickRecordingFormat();
		const ext = blob.type.includes("mp4") ? "m4a" : (format?.ext ?? "webm");
		return { buffer: await blob.arrayBuffer(), ext };
	}

	/** 放弃录音并释放麦克风。 */
	cancel(): void {
		try {
			if (this.recorder && this.recorder.state !== "inactive") {
				this.recorder.stop();
			}
		} catch {
			// 忽略
		}
		this.cleanup();
	}

	private cleanup(): void {
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.recorder = null;
		this.chunks = [];
	}
}
