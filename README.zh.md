# dsh-ui-tool-mode

DSH（DeepSeek Harness）Web 客户端的原生/PTC 工具呈现实时切换插件：在会话头部加一个按钮，
一键在「原生工具 schema」与「PTC（run_code + 生成 SDK）」之间切换**所有**会话的下一次请求，
无需重启、无需改配置文件；同时向模型注入一段系统提示，解释当前模式的含义与正确用法。

## 功能

- **一键切换**：会话头部按钮「工具：PTC ⇄ 工具：原生」，点击即切换全局工具呈现，下一次请求生效
- **真正的实时**：在存活 agent 的作用域上声明 `ctx.tools.presentAs()`，不触发配置重组、不打断运行中的轮次
- **全量覆盖**：加载时扫描 `ctx.agents.list()` 接管所有已存在会话；新 agent 经 `agent/created` 自动接管
- **模型上下文注入**：系统提示新增 `## Tool presentation mode` 小节，告诉模型当前模式、PTC 下要用 run_code 程序调用工具、模式切换不是错误
- **持久化**：状态存 `~/.dsh/tool-mode.json`（原子写入），重启后保持
- **鉴权通道**：浏览器经 `/tool-mode` JSON 通道读写（cookie 鉴权）

## 安装（其他机器）

要求 DSH 版本不低于 0.2.0-rc.2，且组合中含 PTC 运行时（`@deepseek-ai/dsh-ptc-runtime-node`，默认 web 组合已含）：

```sh
pnpm add github:yuexusi/dsh-ui-tool-mode
```

再把包名加进 profile `package.json` 的 `dsh.profile.bundles`，重启 `dsh web` 后会话头部出现切换按钮。

## 开发

```sh
node test/host.mjs     # 宿主全流程测试
node test/render.mjs   # 客户端渲染测试
```

## 已知限制

- 切换影响**所有**会话（全局语义）；未跟踪的旧 agent 回退到 tools 行的全局 mode 配置
- `both` 组合呈现模式不在切换范围

## 许可

[MIT](LICENSE)
