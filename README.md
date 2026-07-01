# Copilot Models

Unlock third-party large language model extensions for GitHub Copilot.

Seamlessly integrate DeepSeek, Zhipu AI, and Qwen LLMs.

One-click switching and native panel compatibility.

## Features

- **Multi-Model Support**: DeepSeek V4, Zhipu AI GLM-5, Qwen 3 series
- **Model Routing**: Automatic failover and latency-based routing
- **Tool Calling**: Full Copilot Chat tool calling support
- **Thinking Mode**: Model reasoning/thinking mode support
- **Circuit Breaker**: Automatic failure protection with retry
- **Secure Authentication**: API keys stored in VS Code SecretStorage
- **Log Debugging**: 4-level logging with hot-reload
- **Lightweight**: OpenAI SDK replaced with native SSE client code
- **Token Plan**: Unified prepaid billing supporting Qwen, DeepSeek, and GLM token packages via a single endpoint

## Documentation

| Language | File |
| :-------- | :----- |
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |

## Quick Start

### 1. Install Extension

Install from the [VS Code Extension Marketplace](https://marketplace.visualstudio.com/items?itemName=chihqiang.vscode-copilot-models).

### 2. Configure API Key

Press `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`), run `Copilot Models: Set API Key`,
select a provider and enter your key.

| Provider | Get API Key |
| :------- | :---------- |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |
| Zhipu AI | [open.bigmodel.cn](https://open.bigmodel.cn/) |
| Qwen | [bailian.console.aliyun.com](https://bailian.console.aliyun.com/) |

**Note:** API keys are stored in VS Code SecretStorage, not as plain settings.

### 3. (Optional) Configure Token Plan

If you use prepaid token packages (e.g., Alibaba DashScope plan),
run `Copilot Models: Set Token Plan` to configure plan access:

1. Press `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`), run `Copilot Models: Set Token Plan`
2. Select a built-in provider preset or enter a custom URL
   - The Qwen preset is preconfigured with the endpoint URL and 9 supported models
3. Enter the plan API token
4. Select the models covered by this plan

The plan token is saved in VS Code SecretStorage.

| Provider | Plan Endpoint |
| :------- | :------------ |
| Qwen (Alibaba Cloud) Token Plan | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |

The Qwen Token Plan preset covers Qwen, DeepSeek, and GLM models in a single plan.
For other providers, choose "Custom URL" and enter the plan API endpoint.

Run `Copilot Models: Clear Token Plan` to remove a configured plan.

### 4. Start Using

1. Open GitHub Copilot Chat panel
2. Click on the model selector
3. Select the model to use
4. Start chatting

## Supported Models

### Qwen (Alibaba Cloud)

| Model | Context | Output | Tool Calling | Thinking Mode |
| :----- | :------: | :----: | :--------: | :--------: |
| Qwen3.7 Max | 1M | 64K | ✅ | ✅ |
| Qwen3.7 Plus | 1M | 64K | ✅ | ✅ |
| Qwen3.6 Flash | 1M | 64K | ✅ | ✅ |
| Qwen3.6 Plus | 128K | 64K | ✅ | ✅ |
| Qwen3 Max | 128K | 64K | ✅ | ✅ |
| Qwen3.5 Flash | 128K | 64K | ✅ | ✅ |

### DeepSeek

| Model | Description | Tool Calling | Thinking Mode |
| :----- | :----- | :--------: | :--------: |
| DeepSeek V4 Flash | Fast response, supports tool calling | ✅ | ✅ |
| DeepSeek V4 Pro | Deep thinking, stronger reasoning | ✅ | ✅ |

### Zhipu AI (BigModel)

| Model | Context | Output | Tool Calling | Thinking Mode |
| :----- | :------: | :----: | :--------: | :--------: |
| GLM-5.2 | 1M | 128K | ✅ | ✅ |
| GLM-5.1 | 200K | 128K | ✅ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ✅ |
| GLM-4.7-Flash | 128K | 16K | ✅ | ❌ |

### Token Plan Coverage

The built-in **Qwen Token Plan** preset supports the following models through
a single unified endpoint:

| Model | ID |
| :---- | :- |
| Qwen3.7 Max | `qwen3.7-max` |
| Qwen3.7 Plus | `qwen3.7-plus` |
| Qwen3.6 Flash | `qwen3.6-flash` |
| Qwen3.6 Plus | `qwen3.6-plus` |
| GLM-5.2 | `glm-5.2` |
| GLM-5.1 | `glm-5.1` |
| GLM-5 | `glm-5` |
| DeepSeek V4 Pro | `deepseek-v4-pro` |
| DeepSeek V4 Flash | `deepseek-v4-flash` |

Models not listed (e.g. Qwen3 Max, GLM-5-Turbo) are still available via direct
provider API access — they are simply not covered by this Token Plan preset.

## Configuration Options

Available in VS Code settings (search `copilot-models`):

### Provider Settings

| Config | Description | Default |
| :----- | :---------- | :------ |
| `<provider>.enabled` | Enable this provider | `true` |
| `<provider>.baseUrl` | API base URL (e.g. `deepseek.baseUrl`) | per provider |
| `<provider>.modelIdOverrides` | Map internal model IDs to custom API model names | `{}` |

### Global Settings

| Config | Description | Default |
| :----- | :---------- | :------ |
| `routingStrategy` | `"failover"` or `"latency"` routing | `"failover"` |
| `failoverModels` | Primary model → fallback model ID map | `{}` |
| `maxTokens` | Maximum generated tokens (0 = unlimited) | `0` |
| `maxImageSize` | Max image input size in bytes | `5242880` |
| `timeoutMs` | Request timeout in milliseconds | `60000` |
| `maxRetries` | Maximum retry attempts | `1` |
| `debugMode` | Log level: `minimal / metadata / verbose` | `minimal` |

## Commands

| Command | Description |
| :----- | :----- |
| `Copilot Models: Set API Key` | Configure API key (select provider first) |
| `Copilot Models: Clear API Key` | Clear API key (select provider first) |
| `Copilot Models: Open Settings` | Open extension settings |
| `Copilot Models: Show Log` | Show log panel |
| `Copilot Models: Clear Log` | Clear logs |
| `Copilot Models: Refresh Models` | Refresh model list |
| `Copilot Models: Show Latency Stats` | Show provider latency statistics |
| `Copilot Models: Set Token Plan` | Configure prepaid token plan |
| `Copilot Models: Clear Token Plan` | Remove configured token plan |

## Debugging

If you encounter issues, check the logs:

1. Press `Ctrl+Shift+P`, run `Copilot Models: Show Log`
2. Logs appear in the "Copilot Models" output panel
3. Set `debugMode` to `verbose` for detailed debug output
4. Set to `minimal` (default) for warnings and errors only

Log level changes take effect immediately without reloading the extension.

## License

Apache-2.0
