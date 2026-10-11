/**
 * dsh-ui-tool-mode host entry.
 *
 * Owns the global tool-presentation preference (native vs PTC) in one JSON
 * file, declares the current mode on every live agent's scope through
 * ctx.tools.presentAs() so flips apply to the next request without a restart
 * or a config reload, serves an authenticated /tool-mode JSON channel for the
 * browser toggle, and contributes a system-prompt section that tells the
 * model what its current tool mode means and how to use it.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Cordis plugin identity. */
export const name = "tool-mode";
/** Services come from the loader-entry inject list; see cordis.patch.yml. */

//#region state
/** Presentation modes this plugin switches between. */
const MODES = ["native", "ptc"];

/** Normalize one mode value; defaults to ptc. */
function normalizeMode(value) {
	return value === "native" || value === "ptc" ? value : "ptc";
}

/** Durable one-field state store with atomic writes. */
class ModeStore {
	constructor(path) {
		this.path = path;
		this.mode = "ptc";
	}

	/** Load synchronously at plugin start. */
	load() {
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			this.mode = normalizeMode(parsed?.mode);
		} catch {}
	}

	/** Persist atomically. */
	async persist() {
		const body = JSON.stringify({ mode: this.mode }, null, "\t") + "\n";
		const temp = `${this.path}.tmp-${randomBytes(4).toString("hex")}`;
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(temp, body, "utf8");
		await rename(temp, this.path);
	}
}
//#endregion

//#region prompt section
/**
 * Render the model-facing explanation of the current presentation mode.
 * @param mode - the mode the next request uses.
 */
function renderSection(mode) {
	if (mode === "native") {
		return [
			"## Tool presentation mode: native",
			"",
			"Every available tool is declared as its own native schema; call tools directly by name.",
			"The user may switch this session family to PTC mode between requests: then the tool list collapses to the single run_code tool plus a generated SDK, and every tool becomes await tools.<name>(...) inside one TypeScript program. A change in the tool surface between requests is the user switching modes, not an error.",
		].join("\n");
	}
	return [
		"## Tool presentation mode: PTC (program-tool-calling)",
		"",
		"Tools are presented through the single run_code tool plus a generated TypeScript SDK. Do NOT try to call bash, read, write, or any other tool by its bare name: they are not registered schemas in this mode. Instead write one TypeScript program in run_code that calls await tools.<name>(args) for each tool you need, and return or print what matters. Batch several operations into one program when they are independent.",
		"The user may switch this session family back to native mode between requests: then tools appear as their own schemas and direct calls work again. A change in the tool surface between requests is the user switching modes, not an error.",
	].join("\n");
}
//#endregion

//#region rpc bridge
/** Read one buffered request body with a hard cap. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** Bridge one admitted request to the tool-mode RPC envelope. */
function makeRpcRouteHandler(connectionCtx, handle) {
	return async (req, res) => {
		const write = (status, body) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(body));
		};
		try {
			const admission = connectionCtx.connection.admit(req);
			if ("rejection" in admission) {
				res.writeHead(admission.rejection);
				res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
				return;
			}
			if (req.method !== "POST") {
				write(405, { error: "method not allowed" });
				return;
			}
			if ((req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
				write(415, { error: "content type must be application/json" });
				return;
			}
			const message = JSON.parse(await readBody(req));
			if (message === null || typeof message !== "object" || message.type !== "client-request" || typeof message.rpcId !== "string" || message.rpcId === "" || typeof message.method !== "string") {
				write(400, { type: "server-response", rpcId: "invalid-request", result: { ok: false, error: { code: "gateway/bad-request", message: "invalid client-request message" } } });
				return;
			}
			const result = await handle(message.method, message.payload ?? {});
			write(200, { type: "server-response", rpcId: message.rpcId, result });
		} catch (error) {
			write(500, { error: `rpc failure: ${String(error instanceof Error ? error.message : error)}` });
		}
	};
}
//#endregion

//#region plugin body
/**
 * Install the mode store, per-agent presentations, the prompt section, and
 * the browser RPC channel.
 * @param ctx - host Cordis context with webServer/connection/systemPrompt/tools.
 */
export function apply(ctx) {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const store = new ModeStore(join(home, "tool-mode.json"));
	store.load();

	/** agent id -> presentAs disposer for the mode we declared on it. */
	const declarations = new Map();

	/** Declare the current mode on one agent scope; replaces any previous one. */
	const applyToAgent = (agent) => {
		try {
			const agentCtx = agent?.ctx;
			if (agentCtx === undefined || agent?.id === undefined) return false;
			const previous = declarations.get(agent.id);
			if (previous !== undefined) {
				try { previous(); } catch {}
				declarations.delete(agent.id);
			}
			const disposer = agentCtx.tools.presentAs(store.mode);
			declarations.set(agent.id, disposer);
			return true;
		} catch (error) {
			ctx.logger?.warn?.("tool-mode: presentAs on agent %s failed: %s", String(agent?.id), String(error?.message ?? error));
			return false;
		}
	};

	/** Re-declare the (new) mode on every tracked live agent. */
	const applyToAll = () => {
		let applied = 0;
		for (const agent of agents.values()) if (applyToAgent(agent)) applied += 1;
		return { applied, tracked: agents.size };
	};

	/** Live agents observed through lifecycle events. */
	const agents = new Map();

	// Catch agents that already exist when this plugin loads (HMR install):
	// list() reaches the live store; agent/created covers everything later.
	try {
		for (const agent of (ctx.agents?.list?.() ?? [])) {
			if (agent?.id === undefined || agent?.ctx === undefined) continue;
			agents.set(agent.id, agent);
			applyToAgent(agent);
		}
	} catch (error) {
		ctx.logger?.warn?.("tool-mode: initial agent sweep failed: %s", String(error?.message ?? error));
	}

	ctx.effect(() => {
		const onCreated = (payload) => {
			const agent = payload?.agent ?? payload;
			if (agent?.id === undefined || agent?.ctx === undefined) return;
			agents.set(agent.id, agent);
			applyToAgent(agent);
		};
		const onDisposed = (payload) => {
			const agent = payload?.agent ?? payload;
			if (agent?.id === undefined) return;
			agents.delete(agent.id);
			const disposer = declarations.get(agent.id);
			if (disposer !== undefined) {
				try { disposer(); } catch {}
				declarations.delete(agent.id);
			}
		};
		const created = ctx.on("agent/created", onCreated, { global: true });
		const disposed = ctx.on("agent/disposed", onDisposed, { global: true });
		return () => {
			created();
			disposed();
		};
	}, "tool-mode: agent lifecycle");

	ctx.systemPrompt.section({
		name: "tool-mode",
		order: 9400,
		text: () => renderSection(store.mode),
	});

	const handleRpc = async (endpoint, payload) => {
		try {
			switch (endpoint) {
				case "get":
					return { ok: true, value: { mode: store.mode } };
				case "set": {
					const next = normalizeMode(payload?.mode);
					if (payload?.mode !== next) return { ok: false, error: { code: "tool-mode/invalid", message: "mode must be 'native' or 'ptc'" } };
					if (next !== store.mode) {
						store.mode = next;
						await store.persist();
						applyToAll();
					}
					return { ok: true, value: { mode: store.mode, ...applyToAll() } };
				}
				case "toggle": {
					store.mode = store.mode === "ptc" ? "native" : "ptc";
					await store.persist();
					return { ok: true, value: { mode: store.mode, ...applyToAll() } };
				}
				default:
					return { ok: false, error: { code: "tool-mode/unknown-endpoint", message: `unknown endpoint ${String(endpoint)}` } };
			}
		} catch (error) {
			return { ok: false, error: { code: "tool-mode/failed", message: error instanceof Error ? error.message : String(error) } };
		}
	};

	ctx.inject(["connection", "webServer"], (rpcCtx) => {
		rpcCtx.webServer.register({
			kind: "prefix",
			path: "/tool-mode",
			handler: makeRpcRouteHandler(rpcCtx, handleRpc),
		});
	});

	ctx.logger?.info?.("tool-mode: store at %s, initial mode %s", store.path, store.mode);
}
//#endregion
