# Copilot Models - Developer Guide

## 项目架构

```
src/
├── core/                           # 核心模块
│   ├── interfaces.ts              # 核心接口定义 (IModelProvider, IApiClient, ModelDefinition 等)
│   ├── consts.ts                   # 常量定义
│   ├── registry.ts                  # 模型注册表 (ModelRegistry 单例)
│   └── logger.ts                    # 日志模块 (分类日志输出)
├── providers/                      # 模型提供者
│   ├── base/                       # 基础抽象类
│   │   ├── auth-manager.ts         # BaseAuthManager - 认证管理基类
│   │   ├── client.ts               # BaseApiClient - API 客户端基类 (SSE 流式处理)
│   │   ├── chat-provider.ts        # BaseChatProvider - Chat Provider 基类
│   │   └── index.ts
│   └── deepseek/                   # DeepSeek 实现
│       ├── models.ts               # 模型定义 (DeepSeek V4 Flash/Pro)
│       ├── client.ts               # DeepSeekClient
│       ├── provider.ts             # DeepSeekModelProvider + DeepSeekChatProvider
│       └── index.ts
├── extension.ts                   # 扩展入口
└── test/
    └── extension.test.ts
```

## 核心接口

| 接口 | 说明 |
|------|------|
| `IModelProvider` | 模型提供商接口，定义获取 API 密钥、模型列表等方法 |
| `IApiClient` | API 客户端接口，定义流式请求方法 |
| `ModelDefinition` | 模型定义结构，包含 ID、名称、能力等 |
| `ProviderConfig` | 提供商配置信息 |

## 日志分类

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

## 添加新模型提供商

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

## 开发命令

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

# 打包
pnpm run package
```

## 调试

1. 按 `F5` 启动调试
2. 使用 `copilot-models.showLog` 命令查看日志
3. 日志会输出到 VS Code 的 "Copilot Models" 输出面板

## 发布

1. 确保 `package.json` 中的 `repository`、`publisher` 等信息正确
2. 运行 `pnpm run package` 打包
3. 使用 `vsce publish` 发布到市场

详细发布流程请参考 [VS Code 扩展发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
