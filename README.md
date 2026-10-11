# dsh-ui-tool-mode

Live native/PTC tool-presentation toggle for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web client. One header button flips the tool presentation of **every** conversation for its next request — no restart, no config edits — and an injected prompt section tells the model what its current mode means and how to call tools in it.

English | [中文](README.zh.md)

## Features

- **One-click toggle**: a header button flips the global presentation; effective on the next request.
- **Genuinely live**: declares `ctx.tools.presentAs()` on every live agent's scope — no config reload, no interrupted turns.
- **Full coverage**: an initial `ctx.agents.list()` sweep adopts agents that already exist when the plugin loads; `agent/created` adopts everything later.
- **Model context injection**: a `## Tool presentation mode` system-prompt section explains the active mode (in PTC: call tools only through run_code programs, never bare names) and that mid-conversation surface changes are the user switching modes, not an error.
- **Durable**: state persists in `~/.dsh/tool-mode.json` (atomic writes).
- **Authenticated channel**: the browser reads/writes through the `/tool-mode` JSON route behind the session cookie.

## Install

Requires DSH 0.2.0-rc.2 or newer and a composed PTC runtime (`@deepseek-ai/dsh-ptc-runtime-node`; the default web composition ships one):

```sh
pnpm add github:yuexusi/dsh-ui-tool-mode
```

Then add the package to `dsh.profile.bundles` in the profile's `package.json` and restart `dsh web`. The toggle appears in the conversation header.

## Development

```sh
node test/host.mjs     # host-side flow tests
node test/render.mjs   # client render tests
```

## Known limits

- The toggle is global (all conversations); untracked stale agents fall back to the tools row's global mode config.
- The `both` combined presentation is out of scope.

## License

[MIT](LICENSE)
