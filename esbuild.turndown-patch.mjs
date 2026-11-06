/**
 * defuddle 的 Markdown 输出依赖 turndown，但 turndown 的 package.json browser 字段
 * 会把 Node 版入口（基于 @mixmark-io/domino 的纯 JS DOM）替换为依赖全局
 * window/document 的 browser 版。Obsidian 渲染进程存在全局 DOM，turndown 便会用
 * Obsidian 自身的 DOMParser 解析 defuddle 传来的 HTML 字符串——与上游 linkedom
 * 内存 DOM 混用，导致提取结果混入整页噪声、丢失懒加载图片。
 *
 * 本插件强制把 turndown 解析到 Node 版实现，并移除其仅存的全局 window 检测
 * （var root = typeof window !== 'undefined' ? window : {}），使其在任何宿主
 * 环境下都只使用 domino。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));

const TURNDOWN_NODE_ENTRY = path.join(
	pluginDir,
	"node_modules",
	"turndown",
	"lib",
	"turndown.cjs.js",
);
const DOMINO_ENTRY = path.join(
	pluginDir,
	"node_modules",
	"@mixmark-io",
	"domino",
	"lib",
	"index.js",
);

// turndown.cjs.js 中仅有的全局检测（lib/turndown.cjs.js L444）
const ROOT_WINDOW_NEEDLE = "var root = typeof window !== 'undefined' ? window : {};";

export const nodeTurndownPatch = {
	name: "node-turndown",
	setup(build) {
		// 绕过 browser 字段对入口文件的映射（cjs.js → browser.cjs.js）
		build.onResolve({ filter: /^turndown$/ }, () => ({ path: TURNDOWN_NODE_ENTRY }));
		// browser 字段同时把 domino 映射为 false（空模块），一并绕过
		build.onResolve({ filter: /^@mixmark-io\/domino$/ }, () => ({ path: DOMINO_ENTRY }));
		build.onLoad(
			{ filter: /turndown[\\/]lib[\\/]turndown\.cjs\.js$/ },
			async (args) => {
				const contents = await fs.readFile(args.path, "utf8");
				if (!contents.includes(ROOT_WINDOW_NEEDLE)) {
					throw new Error(
						`turndown patch target not found in ${args.path}; ` +
							"the package may have changed, update the patch in esbuild.turndown-patch.mjs",
					);
				}
				return {
					contents: contents.replaceAll(ROOT_WINDOW_NEEDLE, "var root = {};"),
					loader: "js",
				};
			},
		);
	},
};
