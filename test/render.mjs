#!/usr/bin/env node
import { readFileSync } from "node:fs";
const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let captured = null;
new Function("window", code)({ __ModuleLoader__: { load: (d) => { captured = d; } } });

let fetchCalls = [];
globalThis.fetch = async (url, init) => {
	const body = JSON.parse(init.body);
	fetchCalls.push({ url, method: body.method, type: body.type, rpcId: body.rpcId });
	const mode = fetchMode;
	return { status: 200, json: async () => ({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { mode, applied: 1, tracked: 1 } } }) };
};
let fetchMode = "ptc";

const reactStub = {
	createElement: (type, props, ...children) => {
		const node = { type, props: props ?? {}, children: children.flat(Infinity) };
		if (typeof type === "function") return type(node.props);
		return node;
	},
	Fragment: "fragment",
	memo: (c) => c,
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useRef: (i) => ({ current: i }),
	useCallback: (fn) => fn,
};
const client = captured.factory((id) => id === "react" ? reactStub : (() => { throw new Error("unexpected require " + id); })());

const dictionaries = { zh: {}, en: {} };
let slotEntry = null;
const fakeCtx = () => ({
	effect: (fn) => { fn(); return () => {}; },
	locale: {
		register: (_ns, dict) => { Object.assign(dictionaries.zh, dict.zh); Object.assign(dictionaries.en, dict.en); return () => {}; },
		bind: () => (key, params) => {
			let text = dictionaries.zh[key] ?? key;
			if (params !== undefined) for (const [name, value] of Object.entries(params)) text = text.replaceAll("{" + name + "}", String(value));
			return text;
		},
	},
	slots: {
		inject: (slotName, factory) => { slotEntry = { name: slotName, options: null, component: null }; factory(); },
		register: (options, component) => { slotEntry.options = options; slotEntry.component = component; return () => {}; },
	},
});
client.apply(fakeCtx());
if (slotEntry === null) throw new Error("slot not registered");
if (slotEntry.name !== "conversation.session.header.actions") throw new Error("header actions slot: " + slotEntry.name);
if (slotEntry.options.id !== "tool-mode") throw new Error("slot id");
const t = fakeCtx().locale.bind();
if (t("button.mode", { mode: t("mode.ptc") }) !== "工具：PTC") throw new Error("zh label");

// initial render (mode loading state)
const I = client.__internals;
let tree = I.ToolModeButton({ t });
const walk = (node, parts = []) => {
	if (node === null || node === undefined || typeof node !== "object") return parts;
	for (const child of node.children ?? []) {
		if (typeof child === "string") parts.push(child);
		else if (child !== null && typeof child === "object") walk(child, parts);
	}
	return parts;
};
if (!walk(tree).join(" ").includes("…")) throw new Error("loading label");

// toggle path
let toggled = await I.rpcCall("toggle", {});
if (toggled.mode !== "ptc") throw new Error("rpc shape");
if (fetchCalls.at(-1).type !== "client-request" || fetchCalls.at(-1).rpcId.startsWith("tm-") === false) throw new Error("envelope");
console.log("slot:", slotEntry.name, "id:", slotEntry.options.id, "order:", slotEntry.options.order);
console.log("ALL CLIENT CHECKS PASSED");
