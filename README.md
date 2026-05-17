# Copilot Models

Unlock third-party large language model extensions for GitHub Copilot.

Seamlessly integrate mainstream LLMs like DeepSeek and Zhipu AI.

One-click switching and native panel compatibility.

## Features

- **Multi-Model Support**: Supports DeepSeek V4 series and Zhipu AI GLM-5 series
- **Tool Calling**: Supports Copilot Chat tool calling functionality
- **Thinking Mode**: Supports model thinking/reasoning mode
- **Secure Authentication**: API keys securely stored in VS Code SecretStorage
- **Log Debugging**: Complete logging system for troubleshooting

## Documentation

This project supports multiple languages for documentation:

| Language | File |
| :-------- | :----- |
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |

## Quick Start

### 1. Install Extension

Install the "Copilot Models" extension from the [VS Code Extension Marketplace](https://marketplace.visualstudio.com/items?itemName=chihqiang.vscode-copilot-models).

### 2. Configure API Key

#### Method 1: Command Palette

1. Press `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`)
2. Type `Copilot Models: Set API Key`
3. Press Enter, then enter the provider name (e.g., `deepseek` or `bigmodel`)
4. Enter the corresponding API key

#### Method 2: Settings Page

1. Press `Ctrl+,` to open VS Code settings
2. Search for `copilot-models`
3. Enter the API key in the corresponding provider's API Key field

> **Tips**:
>
> - DeepSeek API Key can be obtained from [DeepSeek Platform](https://platform.deepseek.com/)
> - Zhipu AI API Key can be obtained from [Zhipu AI Open Platform](https://open.bigmodel.cn/)

### 3. Start Using

1. Open GitHub Copilot Chat panel
2. Click on the model selector
3. Select the model to use
4. Start chatting

## Supported Models

### DeepSeek

| Model | Description | Tool Calling | Thinking Mode |
| :----- | :----- | :--------: | :--------: |
| DeepSeek V4 Flash | Fast response, supports tool calling | ✅ | ✅ |
| DeepSeek V4 Pro | Deep thinking, stronger reasoning | ❌ | ✅ |

### Zhipu AI (BigModel)

| Model | Context | Output | Tool Calling | Thinking Mode |
| :----- | :------: | :----: | :--------: | :--------: |
| GLM-5.1 | 200K | 128K | ✅ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ✅ |

## Configuration Options

The following configuration options are available in VS Code settings:

| Setting | Description | Default |
| :------ | :----- | :------- |
| DeepSeek API Key | DeepSeek API key | - |
| DeepSeek Base URL | DeepSeek API base URL | `https://api.deepseek.com` |
| BigModel API Key | Zhipu AI API key | - |
| BigModel Base URL | Zhipu AI API | `https://open.bigmodel.cn/api/paas/v4` |
| Max Tokens | Maximum generated tokens | 0 (unlimited) |
| Debug Mode | Log level | `minimal` |

## Commands

| Command | Description |
| :----- | :----- |
| `Copilot Models: Set API Key` | Configure API key (select provider first) |
| `Copilot Models: Clear API Key` | Clear API key (select provider first) |
| `Copilot Models: Open Settings` | Open extension settings |
| `Copilot Models: Show Log` | Show log panel |
| `Copilot Models: Clear Log` | Clear logs |
| `Copilot Models: Refresh Models` | Refresh model list |

## Debugging

If you encounter issues, you can check the logs:

1. Press `Ctrl+Shift+P`, type `Copilot Models: Show Log`
2. Logs will be displayed in the "Copilot Models" output panel
3. For more detailed logs, change `Debug Mode` to `verbose` in settings

## License

Apache-2.0
