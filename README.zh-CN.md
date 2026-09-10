# Copilot Models

给 GitHub Copilot 解锁第三方大模型扩展，无缝接入 DeepSeek、智谱 AI、通义千问。

## 功能特性

- **多模型支持**: DeepSeek V4、智谱 AI GLM-5、通义千问 Qwen 3 系列
- **模型路由**: 自动故障转移和延迟感知路由
- **工具调用**: 支持 Copilot Chat 工具调用功能
- **思考模式**: 支持模型的思考/推理模式
- **视觉代理**: 通过 VS Code 内置模型或自定义 API 为不支持图片输入的模型提供图像描述代理
- **熔断保护**: 自动失败保护与重试机制
- **安全认证**: API 密钥安全存储在 VS Code SecretStorage；日志中的敏感值（密钥、令牌、URL）会自动脱敏
- **日志调试**: 4 级日志系统，支持热重载
- **轻量**: 移除 OpenAI SDK，原生 SSE 客户端实现
- **令牌套餐**: 统一预付费计费，通过单个端点同时覆盖通义千问、DeepSeek、GLM 的令牌套餐

## 快速开始

### 1. 安装扩展

从 [VS Code 扩展市场][marketplace] 安装 "Copilot Models" 扩展。

### 2. 配置 API 密钥

按下 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`)，运行 `Copilot Models: Set API Key`，
选择服务商并输入 API 密钥。

| 服务商 | 获取 API Key |
| :----- | :---------- |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| 智谱 AI | [open.bigmodel.cn](https://open.bigmodel.cn/) |
| 通义千问 | [bailian.console.aliyun.com](https://bailian.console.aliyun.com/) |

**注意**：API 密钥通过命令面板设置，安全存储在 VS Code SecretStorage 中。

### 3. (可选) 配置令牌套餐

如果你使用预付费令牌套餐（例如阿里云 DashScope 套餐），
可以运行 `Copilot Models: Set Token Plan` 配置套餐接入：

1. 按 `Ctrl+Shift+P`，运行 `Copilot Models: Set Token Plan`
2. 选择内置服务商预设或输入自定义 URL
   - 通义千问预设已预配好端点 URL 和 6 个支持的模型
3. 输入套餐 API 令牌
4. 选择该套餐覆盖的模型

套餐令牌安全存储在 VS Code SecretStorage。

- **通义千问 Token Plan** —
  `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

通义千问 Token Plan 预设通过单个端点同时覆盖 Qwen、DeepSeek、GLM 模型。
其他服务商请选择 "Custom URL" 并手动输入套餐 API 端点。

运行 `Copilot Models: Clear Token Plan` 可删除已配置的套餐。

### 4. (可选) 配置视觉模型

如果你想在不原生支持图片输入的模型（如 GLM-5.3、GLM-5.2）中使用图片附件，
可以配置视觉代理，自动将图片转换为文字描述：

1. 按 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`)，运行 `Copilot Models: Set Vision Model`
2. 从列表中选择支持视觉的模型，或选择 "Custom API Endpoint"
3. 如果选择自定义 API 端点，依次输入 URL、模型 ID 和 API 密钥
   （无鉴权的端点密钥留空即可）

视觉代理会在发送消息前先将图片描述为文字，再传递给聊天模型。
自定义 API 端点需支持 OpenAI 兼容接口——既可填基础地址
（`https://host/v1`），也可填完整的 `/chat/completions` 地址，两者都支持。
API 密钥保存在 VS Code SecretStorage 中。

> **注意：** 视觉代理只对无法原生接收图片的模型生效。支持图片输入的模型
> 会直接收到原始图片，不会经过代理。

运行 `Copilot Models: Clear Vision Model` 可清除配置。

### 5. 开始使用

1. 打开 GitHub Copilot Chat 面板
2. 点击模型选择器
3. 选择要使用的模型
4. 开始对话

## 支持的模型

### 通义千问 (Alibaba Cloud)

| 模型 | 上下文 | 输出 | 工具调用 | 图片输入 | 思考模式 |
| :----- | :------: | :----: | :--------: | :------: | :--------: |
| Qwen3.8 Max | 1M | 64K | ✅ | ✅ | ✅ |
| Qwen3.8 Flash | 1M | 64K | ✅ | ✅ | ✅ |
| Qwen3.7 Plus | 1M | 64K | ✅ | ✅ | ✅ |
| Qwen3.7 Flash | 1M | 64K | ✅ | ✅ | ✅ |

### DeepSeek

| 模型 | 上下文 | 输出 | 工具调用 | 图片输入 | 思考模式 |
| :----- | :------: | :----: | :--------: | :------: | :--------: |
| DeepSeek V4.1 Flash | 1M | 384K | ✅ | ✅ | ✅ |

> **注意：** `deepseek-v4-flash` 已停服，`deepseek-v4-pro` 正在逐步下线，
> 两个 ID 的请求在过渡期内均由 DeepSeek-V4.1-Flash 承接。

### 智谱 AI (BigModel)

| 模型 | 上下文 | 输出 | 工具调用 | 图片输入 | 思考模式 |
| :----- | :------: | :----: | :--------: | :------: | :--------: |
| GLM-5.3 | 1M | 128K | ✅ | ❌ | ✅ |
| GLM-5.3-Flash | 1M | 128K | ✅ | ✅ | ✅ |
| GLM-5.2 | 1M | 128K | ✅ | ❌ | ✅ |
| GLM-5.1 | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-4.7-Flash | 200K | 128K | ✅ | ❌ | ❌ |

> **提示：** 图片输入标记为 ❌ 的模型仍可通过视觉代理功能处理图片
> （见快速开始第 4 步）。

### 令牌套餐覆盖范围

内置的**通义千问 Token Plan** 预设通过单个统一端点支持以下模型：

| 模型 | ID |
| :--- | :- |
| Qwen3.8 Max | `qwen3.8-max` |
| Qwen3.8 Flash | `qwen3.8-flash` |
| Qwen3.7 Plus | `qwen3.7-plus` |
| Qwen3.7 Flash | `qwen3.7-flash` |
| GLM-5.2 | `glm-5.2` |
| DeepSeek V4.1 Flash | `deepseek-flash` |

未列出的模型（如 GLM-5-Turbo、kimi-k2.7-code）仍可通过直接 Provider API 访问，
只是不在这个 Token Plan 预设的覆盖范围内。

> **注意：** 上表中的 ID 必须与扩展实际暴露的模型 ID 一致（见"支持的模型"表格）。
> `deepseek-v4-pro` 与 `deepseek-v4-flash` 虽然 DeepSeek API 本身仍接受，
> 但扩展只以 `deepseek-flash` 这一个 ID 暴露它们。

## 配置选项

在 VS Code 设置中搜索 `copilot-models` 配置：

### Provider 设置

| 配置 | 说明 | 默认值 |
| :--- | :--- | :----- |
| `<provider>.enabled` | 启用该 provider | `true` |
| `<provider>.baseUrl` | API 基础地址（如 `deepseek.baseUrl`） | 各 provider 不同 |

### 全局设置

| 配置 | 说明 | 默认值 |
| :--- | :--- | :----- |
| `routingStrategy` | 路由策略：`failover` 或 `latency` | `"failover"` |
| `failoverModels` | 主模型→备用模型 ID 映射 | `{}` |
| `modelIdOverrides` | 将内部模型 ID 映射为自定义 API 模型名 | `{}` |
| `maxImageSize` | 图片输入最大字节数（0 = 不限制） | `20971520` (20MB) |
| `timeoutMs` | API 请求超时（毫秒） | `60000` |
| `maxRetries` | 最大重试次数 | `1` |
| `showStatusBar` | 在状态栏显示今日 token 消耗 | `true` |
| `debugMode` | 日志级别：`minimal / metadata / verbose` | `minimal` |

### 视觉代理设置

| 配置 | 说明 | 默认值 |
| :--- | :--- | :----- |
| `visionModel` | 视觉模型 ID（留空自动检测） | `""` |
| `visionPrompt` | 视觉代理图片描述提示词 | `"Describe all image..."` |
| `visionProxy.apiUrl` | 视觉代理 API 端点 URL（OpenAI 兼容） | `""` |
| `visionProxy.apiModelId` | 视觉代理 API 模型 ID | `""` |
| `visionProxy.timeoutMs` | 视觉代理请求超时（毫秒） | `60000` |
| `visionProxy.maxTokens` | 视觉代理响应最大 token 数 | `1024` |

> **注意：** `visionProxy.maxTokens` 只作用于发往 `visionProxy.apiUrl` 的
> 图片描述请求，不影响正常的对话请求。对话请求没有单独的 `max_tokens` 配置：
> 每个模型自动使用其自身最大输出上限（`maxOutputTokens`）作为 API 的
> `max_tokens` 参数。详见上方"支持的模型"表格中的"输出"列。

## Token 消耗统计

每个完成的请求都会在本地记录 token 消耗——包括直连 API 密钥的请求，
而不只是走令牌套餐的流量。

- 状态栏显示今日 token 数与请求数，例如 `12.3K tok · 18 req`，点击即可打开报表。
  在记录到第一个请求之前该项保持隐藏；将 `copilot-models.showStatusBar`
  设为 `false` 可永久隐藏。
- 运行 `Copilot Models: Show Token Usage` 查看按套餐和按模型的明细。
- 运行 `Copilot Models: Clear Token Usage` 清空已记录的历史。

> **注意：** 只保留最近 1000 条请求记录，更早的会被丢弃，因此“历史总计”
> 是滚动窗口而非生命周期总量。数据保存在 VS Code 全局状态中，不会离开本机。

## 命令

| 命令 | 说明 |
| :----- | :----- |
| `Copilot Models: Set API Key` | 配置 API 密钥（先选择服务商） |
| `Copilot Models: Clear API Key` | 清除 API 密钥（先选择服务商） |
| `Copilot Models: Open Settings` | 打开扩展设置 |
| `Copilot Models: Show Log` | 显示日志面板 |
| `Copilot Models: Clear Log` | 清除日志 |
| `Copilot Models: Refresh Models` | 刷新模型列表 |
| `Copilot Models: Show Latency Stats` | 查看 Provider 延迟统计 |
| `Copilot Models: Show Token Usage` | 查看按套餐/模型统计的 token 消耗 |
| `Copilot Models: Clear Token Usage` | 清空所有已记录的 token 消耗 |
| `Copilot Models: Set Token Plan` | 配置预付费令牌套餐 |
| `Copilot Models: Clear Token Plan` | 删除已配置的令牌套餐 |
| `Copilot Models: Set Vision Model` | 配置视觉代理用于图片描述 |
| `Copilot Models: Clear Vision Model` | 清除视觉代理配置 |

## 调试

如果遇到问题，可以查看日志：

1. 按 `Ctrl+Shift+P`，运行 `Copilot Models: Show Log`
2. 日志会输出到 "Copilot Models" 输出面板
3. 将 `debugMode` 设为 `verbose` 可查看详细调试信息
4. 设为 `minimal`（默认）仅显示警告和错误

日志级别修改后立即生效，无需重载扩展。

每条请求的日志都带结构化前缀（`req=<id> provider=<id> model=<id>`），
只需搜索单个 `req=<id>` 即可串联该请求在路由、Provider、网络层的完整链路。
API 密钥、令牌和 URL 查询字符串都会自动脱敏——密钥绝不会出现在日志面板中。

[marketplace]: https://marketplace.visualstudio.com/items?itemName=chihqiang.vscode-copilot-models

## 许可证

Apache-2.0
