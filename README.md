# Copilot Models

给 GitHub Copilot 解锁第三方大模型扩展，无缝接入 DeepSeek、智谱 AI 等主流 LLM，一键切换、原生面板兼容。

## 功能特性

- **多模型支持**: 支持 DeepSeek V4 系列和智谱 AI GLM-5 系列
- **工具调用**: 支持 Copilot Chat 工具调用功能
- **思考模式**: 支持模型的思考/推理模式
- **安全认证**: API 密钥安全存储在 VS Code SecretStorage
- **日志调试**: 完整的日志系统，便于问题排查

## 快速开始

### 1. 安装扩展

从 VS Code 扩展市场安装 "Copilot Models" 扩展。

### 2. 配置 API 密钥

**方法一：命令面板**

1. 按 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`)
2. 输入 `Copilot Models: Set API Key`
3. 按回车，输入服务商名称（如 `deepseek` 或 `bigmodel`）
4. 输入对应的 API 密钥

**方法二：设置页面**

1. 按 `Ctrl+,` 打开 VS Code 设置
2. 搜索 `copilot-models`
3. 在对应服务商的 API Key 字段输入密钥

> **提示**:
> - DeepSeek API Key 可在 [DeepSeek 平台](https://platform.deepseek.com/) 获取
> - 智谱 AI API Key 可在 [智谱 AI 开放平台](https://open.bigmodel.cn/) 获取

### 3. 开始使用

1. 打开 GitHub Copilot Chat 面板
2. 点击模型选择器
3. 选择要使用的模型
4. 开始对话

## 支持的模型

### DeepSeek

| 模型 | 说明 | 工具调用 | 思考模式 |
|:-----|:-----|:--------:|:--------:|
| DeepSeek V4 Flash | 快速响应，支持工具调用 | ✅ | ✅ |
| DeepSeek V4 Pro | 深度思考，更强推理能力 | ❌ | ✅ |

### 智谱 AI (BigModel)

| 模型 | 上下文 | 输出 | 工具调用 | 思考模式 |
|:-----|:------:|:----:|:--------:|:--------:|
| GLM-5.1 | 200K | 128K | ✅ | ✅ |
| GLM-5-Turbo | 200K | 128K | ✅ | ✅ |
| GLM-5 | 200K | 128K | ✅ | ✅ |

## 配置选项

在 VS Code 设置中可以找到以下配置项：

| 配置项 | 说明 | 默认值 |
|:------|:-----|:-------|
| DeepSeek API Key | DeepSeek API 密钥 | - |
| DeepSeek Base URL | DeepSeek API 基础地址 | `https://api.deepseek.com` |
| BigModel API Key | 智谱 AI API 密钥 | - |
| BigModel Base URL | 智谱 AI API 基础地址 | `https://open.bigmodel.cn/api/paas/v4` |
| Max Tokens | 最大生成令牌数 | 0（无限制） |
| Debug Mode | 日志级别 | `minimal` |

## 命令

| 命令 | 说明 |
|:-----|:-----|
| `Copilot Models: Set API Key` | 配置 API 密钥（先选择服务商） |
| `Copilot Models: Clear API Key` | 清除 API 密钥（先选择服务商） |
| `Copilot Models: Open Settings` | 打开扩展设置 |
| `Copilot Models: Show Log` | 显示日志面板 |
| `Copilot Models: Clear Log` | 清除日志 |
| `Copilot Models: Refresh Models` | 刷新模型列表 |

## 调试

如果遇到问题，可以查看日志：

1. 按 `Ctrl+Shift+P`，输入 `Copilot Models: Show Log`
2. 日志会输出到 "Copilot Models" 输出面板
3. 如果需要更详细的日志，可在设置中将 `Debug Mode` 改为 `verbose`

## 许可证

Apache-2.0
