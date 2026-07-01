# Copilot Models

给 GitHub Copilot 解锁第三方大模型扩展，无缝接入 DeepSeek、智谱 AI、通义千问。

## 功能特性

- **多模型支持**: DeepSeek V4、智谱 AI GLM-5、通义千问 Qwen 3 系列
- **模型路由**: 自动故障转移和延迟感知路由
- **工具调用**: 支持 Copilot Chat 工具调用功能
- **思考模式**: 支持模型的思考/推理模式
- **熔断保护**: 自动失败保护与重试机制
- **安全认证**: API 密钥安全存储在 VS Code SecretStorage
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
   - 通义千问预设已预配好端点 URL 和 9 个支持的模型
3. 输入套餐 API 令牌
4. 选择该套餐覆盖的模型

套餐令牌安全存储在 VS Code SecretStorage。

- **通义千问 Token Plan** —
  `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

通义千问 Token Plan 预设通过单个端点同时覆盖 Qwen、DeepSeek、GLM 模型。
其他服务商请选择 "Custom URL" 并手动输入套餐 API 端点。

运行 `Copilot Models: Clear Token Plan` 可删除已配置的套餐。

### 4. 开始使用

1. 打开 GitHub Copilot Chat 面板
2. 点击模型选择器
3. 选择要使用的模型
4. 开始对话

## 支持的模型

### 通义千问 (Alibaba Cloud)

| 模型 | 上下文 | 输出 | 工具调用 | 思考模式 |
| :----- | :------: | :----: | :--------: | :--------: |
| Qwen3.7 Max | 1M | 64K | ✅ | ✅ |
| Qwen3.7 Plus | 1M | 64K | ✅ | ✅ |
| Qwen3.6 Flash | 1M | 64K | ✅ | ✅ |
| Qwen3.6 Plus | 128K | 64K | ✅ | ✅ |
| Qwen3 Max | 128K | 64K | ✅ | ✅ |
| Qwen3.5 Flash | 128K | 64K | ✅ | ✅ |

### DeepSeek

| 模型 | 说明 | 工具调用 | 思考模式 |
| :----- | :----- | :--------: | :--------: |
| DeepSeek V4 Flash | 快速响应，支持工具调用 | ✅ | ✅ |
| DeepSeek V4 Pro | 深度思考，更强推理能力 | ✅ | ✅ |

### 智谱 AI (BigModel)

| 模型 | 上下文 | 输出 | 工具调用 | 思考模式 |
| :----- | :------: | :----: | :--------: | :--------: |
| GLM-5.2 | 1M | 128K | ✅ | ✅ |
| GLM-5.1 | 200K | 128K | ✅ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ✅ |
| GLM-4.7-Flash | 128K | 16K | ✅ | ❌ |

### 令牌套餐覆盖范围

内置的**通义千问 Token Plan** 预设通过单个统一端点支持以下模型：

| 模型 | ID |
| :--- | :- |
| Qwen3.7 Max | `qwen3.7-max` |
| Qwen3.7 Plus | `qwen3.7-plus` |
| Qwen3.6 Flash | `qwen3.6-flash` |
| Qwen3.6 Plus | `qwen3.6-plus` |
| GLM-5.2 | `glm-5.2` |
| GLM-5.1 | `glm-5.1` |
| GLM-5 | `glm-5` |
| DeepSeek V4 Pro | `deepseek-v4-pro` |
| DeepSeek V4 Flash | `deepseek-v4-flash` |

未列出的模型（如 Qwen3 Max、GLM-5-Turbo）仍可通过直接 Provider API 访问，
只是不在这个 Token Plan 预设的覆盖范围内。

## 配置选项

在 VS Code 设置中搜索 `copilot-models` 配置：

### Provider 设置

| 配置 | 说明 | 默认值 |
| :--- | :--- | :----- |
| `<provider>.enabled` | 启用该 provider | `true` |
| `<provider>.baseUrl` | API 基础地址（如 `deepseek.baseUrl`） | 各 provider 不同 |
| `<provider>.modelIdOverrides` | 将内部模型 ID 映射为自定义 API 模型名 | `{}` |

### 全局设置

| 配置 | 说明 | 默认值 |
| :--- | :--- | :----- |
| `routingStrategy` | 路由策略：`failover` 或 `latency` | `"failover"` |
| `failoverModels` | 主模型→备用模型 ID 映射 | `{}` |
| `maxTokens` | 最大生成令牌数（0=无限制） | `0` |
| `maxImageSize` | 图片输入最大字节数 | `5242880` |
| `timeoutMs` | API 请求超时（毫秒） | `60000` |
| `maxRetries` | 最大重试次数 | `1` |
| `debugMode` | 日志级别：`minimal / metadata / verbose` | `minimal` |

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
| `Copilot Models: Set Token Plan` | 配置预付费令牌套餐 |
| `Copilot Models: Clear Token Plan` | 删除已配置的令牌套餐 |

## 调试

如果遇到问题，可以查看日志：

1. 按 `Ctrl+Shift+P`，运行 `Copilot Models: Show Log`
2. 日志会输出到 "Copilot Models" 输出面板
3. 将 `debugMode` 设为 `verbose` 可查看详细调试信息
4. 设为 `minimal`（默认）仅显示警告和错误

日志级别修改后立即生效，无需重载扩展。

[marketplace]: https://marketplace.visualstudio.com/items?itemName=chihqiang.vscode-copilot-models

## 许可证

Apache-2.0
