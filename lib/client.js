window.__ModuleLoader__.load({
	id: "dsh-ui-tool-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { useState, useEffect, useCallback } = react;
		const h = (type, props, ...children) => react.createElement(type, props, ...children.flat());
		const cx = (...names) => names.filter(Boolean).join(" ");

		//#region locales
		const NS = "tool-mode";
		const zh = {
			"button.mode": "工具：{mode}",
			"mode.ptc": "PTC",
			"mode.native": "原生",
			"action.toggle": "切换工具呈现模式",
			"error.title": "切换失败",
		};
		const en = {
			"button.mode": "Tools: {mode}",
			"mode.ptc": "PTC",
			"mode.native": "Native",
			"action.toggle": "Toggle tool presentation mode",
			"error.title": "Toggle failed",
		};
		//#endregion

		//#region rpc
		let rpcCounter = 0;
		async function rpcCall(endpoint, payload) {
			const response = await fetch(`tool-mode/${endpoint}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "client-request", rpcId: `tm-${(rpcCounter += 1)}`, method: endpoint, payload: payload ?? {} }),
			});
			const body = await response.json().catch(() => null);
			const result = body?.result;
			if (result?.ok === true) return result.value;
			throw new Error(result?.error?.message ?? `rpc ${endpoint} failed (${String(response.status)})`);
		}
		//#endregion

		//#region css
		const css =
			".tmB7_button{border-radius:var(--dsw-radius-sm);height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:var(--dsw-font-xxs-12);background:0 0;border:0;flex:none;align-items:center;gap:5px;padding:0 8px;display:inline-flex}" +
			".tmB7_button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
			".tmB7_button:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}" +
			".tmB7_button:disabled{cursor:default;opacity:.55}" +
			".tmB7_mode{font-weight:600;color:var(--dsw-alias-state-business-primary)}" +
			".tmB7_error{color:var(--dsw-alias-state-error-primary)}";
		const cssTagId = "dsh-ui-tool-mode/styles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ui-tool-mode";
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region view
		function ToolModeButton({ t }) {
			const [mode, setMode] = useState(null);
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(false);
			useEffect(() => {
				let active = true;
				rpcCall("get", {}).then((value) => { if (active) setMode(value.mode); }, () => {});
				return () => { active = false; };
			}, []);
			const onToggle = useCallback(async () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					const value = await rpcCall("toggle", {});
					setMode(value.mode);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			}, [busy]);
			const label = mode === null ? "…" : t("button.mode", { mode: t(mode === "ptc" ? "mode.ptc" : "mode.native") });
			return h("button", {
				className: cx("tmB7_button"),
				type: "button",
				title: error !== null ? t("error.title") + ": " + error : t("action.toggle"),
				disabled: busy,
				onClick: onToggle,
			}, label, mode !== null ? h("span", { className: cx("tmB7_mode") }, "") : null);
		}
		//#endregion

		//#region registration
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "tool-mode: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "tool-mode",
					order: 20,
					locale: NS,
					label: () => t("action.toggle"),
				}, ToolModeButton),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = { ToolModeButton, rpcCall };
		return module.exports;
	},
});
