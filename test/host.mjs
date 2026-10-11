#!/usr/bin/env node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "tool-mode-test-"));
process.env.DSH_HOME = home;
const plugin = await import("../lib/index.js");
if (plugin.name !== "tool-mode") throw new Error("unexpected name");

const routes = [];
let section = null;
const warnings = [];
const presentAsCalls = [];
const fakeAgentCtx = { tools: { presentAs: (mode) => { presentAsCalls.push(mode); return () => {}; } } };
const makeAgent = (id) => ({ id, ctx: fakeAgentCtx });

const ctx = {
	effect: (fn) => { fn(); return () => {}; },
	inject: (_list, cb) => { cb(ctx); return () => {}; },
	agents: { list: () => [] },
	systemPrompt: { section: (s) => { section = s; return () => {}; } },
	webServer: { register: (r) => { routes.push(r); return () => {}; } },
	connection: { admit: () => ({ peer: {} }) },
	logger: { info: () => {}, warn: (...args) => warnings.push(args.join(" ")) },
	on: (name, listener) => {
		// capture lifecycle listeners for manual firing
		listeners.set(name, listener);
		return () => listeners.delete(name);
	},
};
const listeners = new Map();
plugin.apply(ctx);
if (routes.length !== 1 || routes[0].path !== "/tool-mode") throw new Error("route missing");
if (section === null || section.name !== "tool-mode") throw new Error("prompt section missing");
if (presentAsCalls.length !== 0) throw new Error("no agents yet: presentAs must not have run");

// ---- fire lifecycle events ----
listeners.get("agent/created")({ agent: makeAgent("a1") });
listeners.get("agent/created")({ agent: makeAgent("a2") });
if (presentAsCalls.length !== 2 || !presentAsCalls.every((m) => m === "ptc")) throw new Error("agents created before toggle must default to ptc: " + JSON.stringify(presentAsCalls));
const sectionText = section.text();
if (!sectionText.includes("PTC (program-tool-calling)") || !sectionText.includes("run_code")) throw new Error("ptc section text must explain run_code");

// ---- RPC over the route ----
class FakeReq {
	constructor(method, body) { this.method = method; this.headers = { "content-type": "application/json" }; this.body = body; }
	on(event, cb) {
		if (event === "error") setTimeout(() => { if (this.body !== undefined) this.dataCb?.(Buffer.from(this.body)); this.endCb?.(); }, 0);
		else if (event === "data") this.dataCb = cb;
		else if (event === "end") this.endCb = cb;
		return this;
	}
	destroy() {}
}
const drive = async (endpoint, payload) => {
	const req = new FakeReq("POST", JSON.stringify({ type: "client-request", rpcId: "t", method: endpoint, payload: payload ?? {} }));
	const res = { status: 0, body: "" };
	res.writeHead = (s) => { res.status = s; };
	res.end = (b) => { res.body = b ?? ""; };
	await routes[0].handler(req, res);
	if (res.status !== 200) throw new Error(endpoint + " -> " + res.status + " " + res.body);
	return JSON.parse(res.body).result;
};

const initial = await drive("get", {});
if (initial.value.mode !== "ptc") throw new Error("initial mode ptc");
const bad = await drive("set", { mode: "wrong" });
if (bad.ok !== false || bad.error.code !== "tool-mode/invalid") throw new Error("invalid mode rejected");
const toggled = await drive("toggle", {});
if (toggled.value.mode !== "native" || toggled.value.applied !== 2) throw new Error("toggle flips both agents: " + JSON.stringify(toggled.value));
if (presentAsCalls.at(-2) !== "native" || presentAsCalls.at(-1) !== "native") throw new Error("toggle re-declared native on tracked agents");
const afterToggle = section.text();
if (!afterToggle.includes("native")) throw new Error("section follows the toggle");
const setBack = await drive("set", { mode: "ptc" });
if (setBack.value.mode !== "ptc") throw new Error("set ptc");
const persisted = JSON.parse(readFileSync(join(home, "tool-mode.json"), "utf8"));
if (persisted.mode !== "ptc") throw new Error("state persisted");

// ---- reload picks the persisted mode ----
const plugin2 = await import("../lib/index.js?r2");
const listeners2 = new Map();
plugin2.apply({ ...ctx, agents: { list: [] }, on: (n, l) => { listeners2.set(n, l); return () => listeners2.delete(n); } });
listeners2.get("agent/created")({ agent: makeAgent("b1") });
if (presentAsCalls.at(-1) !== "ptc") throw new Error("fresh instance follows persisted state");

// ---- presentAs failure surfaces a warning, not a crash ----
const brokenCtx = { tools: { presentAs: () => { throw new Error("no scope"); } } };
listeners.get("agent/created")({ agent: { id: "bad", ctx: brokenCtx } });
if (!warnings.some((w) => w.includes("no scope"))) throw new Error("presentAs failure warned: " + warnings.join("; "));

console.log("ALL TOOL-MODE HOST CHECKS PASSED");
