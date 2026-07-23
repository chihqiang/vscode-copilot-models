# Copilot Models

Unlock third-party large language model extensions for GitHub Copilot.

Seamlessly integrate DeepSeek, Zhipu AI, and Qwen LLMs.

One-click switching and native panel compatibility.

## Features

- **Multi-Model Support**: DeepSeek V4, Zhipu AI GLM-5, Qwen 3 series
- **Model Routing**: Automatic failover and latency-based routing
- **Tool Calling**: Full Copilot Chat tool calling support
- **Thinking Mode**: Model reasoning/thinking mode support
- **Vision Proxy**: Image description proxy for non-vision models
  via VS Code LM or custom API
- **Circuit Breaker**: Automatic failure protection with retry
- **Secure Authentication**: API keys stored in VS Code SecretStorage
- **Log Debugging**: 4-level logging with hot-reload
- **Lightweight**: OpenAI SDK replaced with native SSE client code
- **Token Plan**: Unified prepaid billing for Qwen, DeepSeek, and
  GLM token packages via a single endpoint

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

- **Qwen Token Plan** —
  `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

The Qwen Token Plan preset covers Qwen, DeepSeek, and GLM models
in a single plan.
For other providers, choose "Custom URL" and enter the plan API endpoint.

Run `Copilot Models: Clear Token Plan` to remove a configured plan.

### 4. (Optional) Configure Vision Model

If you want to use image attachments with models that don't natively support
image input (e.g., GLM-5 series, Qwen3.7 Max), configure a vision proxy to
automatically convert images to text descriptions:

1. Press `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`), run
   `Copilot Models: Set Vision Model`
2. Select a vision-capable model, or choose "Custom API Endpoint"
3. For custom API endpoint, enter the URL and model ID

The vision proxy describes images before sending them to the chat model.
For custom API endpoints, an OpenAI-compatible `/chat/completions` endpoint is required.

Run `Copilot Models: Clear Vision Model` to remove the configuration.

### 5. Start Using

1. Open GitHub Copilot Chat panel
2. Click on the model selector
3. Select the model to use
4. Start chatting

## Supported Models

### Qwen (Alibaba Cloud)

| Model | Context | Output | Tool Calling | Image Input | Thinking Mode |
| :----- | :------: | :----: | :--------: | :---------: | :--------: |
| Qwen3.7 Max | 1M | 64K | ✅ | ❌ | ✅ |
| Qwen3.7 Plus | 1M | 64K | ✅ | ✅ | ✅ |
| Qwen3.6 Flash | 1M | 64K | ✅ | ✅ | ✅ |
| Qwen3.6 Plus | 128K | 64K | ✅ | ✅ | ✅ |
| Qwen3 Max | 128K | 64K | ✅ | ✅ | ✅ |
| Qwen3.5 Flash | 128K | 64K | ✅ | ✅ | ✅ |

### DeepSeek

| Model | Context | Output | Tool Calling | Image Input | Thinking Mode |
| :----- | :------: | :----: | :--------: | :---------: | :--------: |
| DeepSeek V4 Flash | 640K | 384K | ✅ | ✅ | ✅ |
| DeepSeek V4 Pro | 640K | 384K | ✅ | ✅ | ✅ |

### Zhipu AI (BigModel)

| Model | Context | Output | Tool Calling | Image Input | Thinking Mode |
| :----- | :------: | :----: | :--------: | :---------: | :--------: |
| GLM-5.2 | 1M | 128K | ✅ | ❌ | ✅ |
| GLM-5.1 | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ❌ | ✅ |
| GLM-4.7-Flash | 128K | 16K | ✅ | ❌ | ❌ |

> **Tip:** Models marked with ❌ for Image Input can still handle images
> through the Vision Proxy feature (see Quick Start step 4).

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

### Global Settings

| Config | Description | Default |
| :----- | :---------- | :------ |
| `routingStrategy` | `"failover"` or `"latency"` routing | `"failover"` |
| `failoverModels` | Primary model → fallback model ID map | `{}` |
| `modelIdOverrides` | Map model IDs to custom API names | `{}` |
| `maxImageSize` | Max image size in bytes (0 = disabled) | `20971520` (20MB) |
| `timeoutMs` | Request timeout in milliseconds | `60000` |
| `maxRetries` | Maximum retry attempts | `1` |
| `debugMode` | Log level: `minimal / metadata / verbose` | `minimal` |

### Vision Proxy Settings

| Config | Description | Default |
| :----- | :---------- | :------ |
| `visionModel` | Vision model ID (empty for auto-detect) | `""` |
| `visionPrompt` | Prompt for vision proxy description | `"Describe all..."` |
| `visionProxy.apiUrl` | Vision proxy API URL (OpenAI-compatible) | `""` |
| `visionProxy.apiModelId` | Model ID for vision proxy API endpoint | `""` |
| `visionProxy.timeoutMs` | Vision proxy timeout in milliseconds | `60000` |
| `visionProxy.maxTokens` | Max tokens for vision proxy response | `1024` |

> **Note:** The `maxTokens` config has been removed. Each model now
> automatically uses its own `maxOutputTokens` as the API's `max_tokens`
> parameter — no manual configuration needed. See the "Output" column in
> the Supported Models tables above.

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
| `Copilot Models: Set Vision Model` | Configure vision image proxy |
| `Copilot Models: Clear Vision Model` | Clear vision proxy configuration |

## Debugging

If you encounter issues, check the logs:

1. Press `Ctrl+Shift+P`, run `Copilot Models: Show Log`
2. Logs appear in the "Copilot Models" output panel
3. Set `debugMode` to `verbose` for detailed debug output
4. Set to `minimal` (default) for warnings and errors only

Log level changes take effect immediately without reloading the extension.

## License

Apache-2.0
