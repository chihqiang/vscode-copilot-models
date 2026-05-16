# Copilot Models

给 GitHub Copilot 解锁第三方大模型扩展，无缝接入 DeepSeek 等主流 LLM，一键切换、原生面板兼容。

## 功能特性

- **多模型支持**: 采用插件化架构，可方便地接入多种语言模型
- **DeepSeek V4**: 首个支持的模型，包括 V4 Flash 和 V4 Pro
- **工具调用**: 支持 Copilot Chat 工具调用功能
- **思考模式**: 支持 DeepSeek 的思考模式（reasoning）
- **视觉能力**: 支持图片输入（通过视觉代理模型）
- **安全认证**: API 密钥安全存储在 VS Code SecretStorage
- **日志调试**: 完整的日志系统，支持分类日志输出

## 支持的模型

### DeepSeek

| 模型 ID | 名称 | 工具调用 | 思考模式 | 视觉输入 |
|---------|------|----------|----------|----------|
| `deepseek-chat` | DeepSeek V4 Flash | ✅ | ✅ | ❌ |
| `deepseek-reasoner` | DeepSeek V4 Pro | ❌ | ✅ | ❌ |

## 项目架构

```
src/
├── core/                           # 核心模块
│   ├── interfaces.ts              # 核心接口定义 (IModelProvider, IApiClient, ModelDefinition 等)
│   ├── consts.ts                 # 常量定义
│   ├── registry.ts               # 模型注册表 (ModelRegistry 单例)
│   └── logger.ts                 # 日志模块 (分类日志输出)
├── providers/                      # 模型提供者
│   ├── base/                      # 基础抽象类
│   │   ├── auth-manager.ts       # BaseAuthManager - 认证管理基类
│   │   ├── client.ts             # BaseApiClient - API 客户端基类 (SSE 流式处理)
│   │   ├── chat-provider.ts      # BaseChatProvider - Chat Provider 基类
│   │   └── index.ts
│   └── deepseek/                  # DeepSeek 实现
│       ├── models.ts             # 模型定义 (DeepSeek V4 Flash/Pro)
│       ├── client.ts             # DeepSeekClient
│       ├── provider.ts            # DeepSeekModelProvider + DeepSeekChatProvider
│       └── index.ts
├── extension.ts                   # 扩展入口
└── test/
    └── extension.test.ts
```

### 核心接口

| 接口 | 说明 |
|------|------|
| `IModelProvider` | 模型提供商接口，定义获取 API 密钥、模型列表等方法 |
| `IApiClient` | API 客户端接口，定义流式请求方法 |
| `ModelDefinition` | 模型定义结构，包含 ID、名称、能力等 |
| `ProviderConfig` | 提供商配置信息 |

### 日志分类

日志系统支持以下分类，便于调试和问题排查：

| 分类 | 说明 |
|------|------|
| `core` | 核心模块日志 |
| `registry` | 模型注册表日志 |
| `provider` | 提供者通用日志 |
| `deepseek` | DeepSeek 提供者日志 |
| `auth` | 认证模块日志 |
| `api` | API 请求日志 |
| `chat` | Chat 会话日志 |
| `stream` | 流式处理日志 |
| `config` | 配置变更日志 |

### 添加新模型提供商

1. 在 `providers/` 下创建新目录（如 `providers/openai/`）
2. 创建模型定义 `models.ts`
3. 创建 API 客户端继承 `BaseApiClient`
4. 创建 Provider 继承 `BaseChatProvider`
5. 在 `extension.ts` 中调用注册函数
6. 在 `providers/index.ts` 中导出

**示例步骤：**

```typescript
// 1. 创建 models.ts
export const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    family: 'openai',
    version: '1.0',
    detail: 'GPT-4 by OpenAI',
    maxInputTokens: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: false,
    },
  },
];

// 2. 创建 client.ts，继承 BaseApiClient
// 3. 创建 provider.ts，实现 IModelProvider 和 Chat Provider
// 4. 在 extension.ts 中注册
export function registerOpenAIProvider(context: vscode.ExtensionContext): OpenAIChatProvider {
  const chatProvider = new OpenAIChatProvider(context);
  ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider);
  return chatProvider;
}
```

## 开发

```bash
# 安装依赖
pnpm install

# 编译
pnpm run compile

# 监听模式
pnpm run watch

# 代码检查
pnpm run lint

# 修复代码风格问题
pnpm run lint:fix
```

## 配置

### DeepSeek 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `copilot-models.deepseekApiKey` | DeepSeek API 密钥 | - |
| `copilot-models.deepseekBaseUrl` | DeepSeek API 基础 URL | `https://api.deepseek.com` |
| `copilot-models.modelIdOverrides` | 模型 ID 覆盖（用于代理） | `{}` |

### 思考模式配置

对于支持思考模式的模型（如 DeepSeek V4 Pro），可在模型配置中设置：

| 配置项 | 说明 | 可选值 |
|--------|------|--------|
| `reasoningEffort` | 思考努力程度 | `none`, `high`, `max` |

## 命令

| 命令 ID | 说明 |
|---------|------|
| `copilot-models.setApiKey` | 配置 API 密钥 |
| `copilot-models.clearApiKey` | 清除 API 密钥 |
| `copilot-models.openSettings` | 打开扩展设置 |
| `copilot-models.showLog` | 显示日志面板 |
| `copilot-models.clearLog` | 清除日志 |
| `copilot-models.refreshModels` | 刷新模型列表 |

## 调试

1. 按 `F5` 启动调试
2. 使用 `copilot-models.showLog` 命令查看日志
3. 日志会输出到 VS Code 的 "Copilot Models" 输出面板

## 许可证

Apache-2.0
