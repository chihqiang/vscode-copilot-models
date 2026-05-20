# Copilot Models - Developer Guide

## 项目架构

```text
src/
├── core/                           # 核心模块
│   ├── models.ts                   # 模型定义接口
│   ├── model-registry.ts           # 模型注册表
│   ├── provider-registry.ts        # 提供者工厂注册表
│   ├── logger.ts                   # 日志模块
│   ├── auth-manager.ts             # 认证管理基类
│   ├── chat-provider.ts            # Chat Provider 基类
│   ├── client.ts                   # API 客户端基类
│   ├── model-provider.ts           # 模型提供商基类
│   ├── provider-factory.ts         # Provider 工厂函数
│   └── index.ts                    # 核心模块导出
├── providers/                      # 模型提供者
│   ├── deepseek/                  # DeepSeek 实现
│   │   └── index.ts
│   ├── bigmodel/                  # 智谱 AI 实现
│   │   └── index.ts
│   ├── qwen/                      # 通义千问实现
│   │   └── index.ts
│   └── index.ts                   # 提供者统一导出
├── extension.ts                    # 扩展入口
└── test/                          # 测试文件
    ├── index.ts                   # 测试入口
    ├── runTest.ts                 # 测试运行器
    ├── model-registry.test.ts     # ModelRegistry 测试
    ├── provider-registry.test.ts   # ProviderFactoryRegistry 测试
    ├── models.test.ts             # 模型定义测试
    ├── client.test.ts             # API 客户端测试
    └── auth-manager.test.ts       # 认证管理器测试
```

## 配置与 API Key

- API 密钥通过命令面板设置：使用 `Copilot Models: Set API Key`，
  选择提供者并输入密钥。密钥存储在 VS Code `SecretStorage` 中。
- 扩展提供以下设置项（示例）：
  - `copilot-models.deepseek.enabled`（是否启用 DeepSeek）
  - `copilot-models.deepseekBaseUrl`（DeepSeek API 基础地址）
  - `copilot-models.bigmodel.enabled`（是否启用 BigModel）
  - `copilot-models.bigmodelBaseUrl`（BigModel API 基础地址）
  - `copilot-models.qwen.enabled`（是否启用通义千问）
  - `copilot-models.qwenBaseUrl`（通义千问 API 基础地址）
  - `copilot-models.modelIdOverrides`（模型 ID 覆盖映射）
  - `copilot-models.maxTokens`（最大生成令牌，0 表示无限制）

## 核心接口

| 接口 | 说明 |
| :----- | :----- |
| `IModelProvider` | 模型提供商接口，定义获取 API 密钥、模型列表等方法 |
| `IApiClient` | API 客户端接口，定义流式请求方法 |
| `IChatProvider<T>` | Chat Provider 接口，扩展 VS Code LanguageModelChatProvider |
| `ModelDefinition` | 模型定义结构，包含 ID、名称、能力等 |
| `ModelCapabilities` | 模型能力定义，包含 toolCalling、imageInput、thinking |
| `ProviderConfig` | 提供商配置信息 |
| `IProviderFactory` | 提供者工厂接口，用于动态注册新提供商 |
| `IAuthManager` | 认证管理器接口，定义 API 密钥的获取和存储方法 |

## 日志系统

### 使用方式

每个 provider 使用 `createProviderLogger` 创建独立的日志记录器：

```typescript
import { createProviderLogger, logger as globalLogger } from '../../core/logger';

// 创建 provider 日志
const providerLogger = createProviderLogger('deepseek', 'DeepSeek');

// 扩展通用日志（可选）
const logger = {
    ...providerLogger,
    chat: globalLogger.chat,
    stream: globalLogger.stream,
};

// 使用
logger.info('消息');        // [时间] [INFO] [DeepSeek] 消息
logger.debug('调试信息');   // 仅开发模式输出
```

### 日志级别

日志系统支持 **4 个日志级别**，自动区分开发环境和生产环境：

| 级别 | 说明 | 开发模式 | 生产模式 |
| :----- | :----- | :-------: | :-------: |
| `debug` | 详细调试信息 | ✅ 输出 | ❌ 不输出 |
| `info` | 一般信息 | ✅ 输出 | ✅ 输出 |
| `warn` | 警告信息 | ✅ 输出 | ✅ 输出 |
| `error` | 错误信息 | ✅ 输出 | ✅ 输出 |

### 环境检测

- **开发模式**：`NODE_ENV=development` 或调试会话中
- **生产模式**：插件以安装包形式运行时

### 性能优化

日志系统采用 **惰性求值** 策略，只在日志级别允许时才进行格式化：

```typescript
// 即使传递复杂对象，也不会有性能问题
logger.debug('Complex data:', largeObject); // 如果 debug 被禁用，不会格式化

// 可以安全地在循环中使用
for (const item of items) {
  logger.debug('Processing item:', item); // 无性能损失
}
```

**性能提升**：在生产环境（info 级别）下，调用 `logger.debug()` 1000 次，性能提升约 **500 倍**。

## 动态注册机制

扩展使用 **ProviderFactoryRegistry** 实现动态注册，支持在不修改 `extension.ts` 的情况下添加新提供商。

### 注册流程

```text
模块加载 → registerAllProviders() → 注册所有 IProviderFactory → ProviderFactoryRegistry
                                                      ↓
扩展激活 → getEnabledFactories() → 遍历注册 → vscode.lm.registerLanguageModelChatProvider()
```

### 添加新模型提供商

使用 `createGenericProviderFactory` 可以快速创建 Provider，所有代码集中在一个文件中：

```typescript
// providers/example/index.ts
/**
 * Example 模型提供者模块
 */

import {
  ApiRequest,
  ClientOptions,
  CONFIG_SECTION,
  createApiClient,
  createGenericProviderFactory,
  ModelDefinition,
  ThinkingEffort,
} from "../../core";

// ── 模型定义 ──────────────────────────────────────────

export const EXAMPLE_MODELS: ModelDefinition[] = [
  {
    id: 'example-v1',
    name: 'Example V1',
    family: 'example',
    version: '1.0',
    detail: 'Example API model',
    maxInputTokens: 8192,
    maxOutputTokens: 2048,
    capabilities: {
      toolCalling: false,
      imageInput: false,
      thinking: false,
    },
  },
];

export const EXAMPLE_PROVIDER_ID = "example";

export const EXAMPLE_DEFAULT_BASE_URL = "https://api.example.com";

// ── Provider 注册 ─────────────────────────────────────
const { register } = createGenericProviderFactory({
  providerId: EXAMPLE_PROVIDER_ID,
  providerName: "Example",
  defaultBaseUrl: EXAMPLE_DEFAULT_BASE_URL,
  models: EXAMPLE_MODELS,
  apiKeyPrompt: "Enter your Example API Key",
  apiKeyPlaceholder: "example-sk-...",
  configSection: CONFIG_SECTION,
  createClient: function (
    baseUrl: string,
    apiKey: string,
    options?: ClientOptions,
  ) {
    return createApiClient({
      baseUrl,
      apiKey,
      providerName: "Example",
      timeoutMs: options?.timeoutMs ?? 60_000,
      maxRetries: options?.maxRetries ?? 1,
    });
  },
  // 可选：自定义思考参数转换
  convertThinkingParams: (request: ApiRequest, effort: ThinkingEffort) => {
    if (effort !== "none") {
      request.reasoning_effort = effort;
    }
  },
});

export function registerExampleProviderFactory(): void {
  register();
}
```

`src/providers/index.ts` 中的内置注册逻辑如下：

```typescript
export * from './deepseek';
export * from './bigmodel';
export * from './qwen';

import { registerDeepSeekProviderFactory } from './deepseek';
import { registerBigModelProviderFactory } from './bigmodel';
import { registerQwenProviderFactory } from './qwen';

export function registerAllProviders(): void {
  registerDeepSeekProviderFactory();
  registerBigModelProviderFactory();
  registerQwenProviderFactory();
}
```

#### 基类功能一览

| 基类 | 功能 |
| :----- | :----- |
| `BaseModelProvider` | API Key 管理、配置读取、模型 ID 覆盖、客户端创建 |
| `BaseChatProvider` | 消息转换、角色映射、流式回调、请求发送、API Key 配置、模型选择器 |
| `BaseApiClient` | 基于 OpenAI SDK 的流式请求处理、错误处理、取消令牌支持、工具调用处理 |
| `BaseAuthManager` | 通过 SecretStorage 安全存储 API 密钥 |

#### 错误处理

客户端提供完善的错误处理机制，支持以下错误类型：

| 错误类 | 状态码 | 说明 |
| :----- | :----- | :----- |
| `ApiError` | - | 基础 API 错误 |
| `AuthenticationError` | 401 | 认证失败 |
| `PermissionError` | 403 | 权限不足 |
| `NotFoundError` | 404 | 资源未找到 |
| `PayloadTooLargeError` | 413 | 请求体过大 |
| `UnsupportedMediaTypeError` | 415 | 不支持的媒体类型 |
| `RateLimitError` | 429 | 速率限制 |
| `ServiceUnavailableError` | 503 | 服务不可用 |
| `TimeoutError` | - | 请求超时 |
| `NetworkError` | - | 网络错误 |
| `CancelledError` | - | 请求取消 |

## 测试

### 测试命令

```bash
# 编译并运行测试
npm run test

# 仅编译测试（不运行）
npm run test:compile
```

### 测试文件结构

| 文件 | 说明 |
| :----- | :----- |
| `model-registry.test.ts` | ModelRegistry 单例测试：提供者注册/注销、模型列表管理、单例模式 |
| `provider-registry.test.ts` | ProviderFactoryRegistry 测试：工厂注册、启用/禁用状态过滤 |
| `models.test.ts` | 模型定义接口测试：CONFIG_SECTION、ModelCapabilities、ModelDefinition |
| `client.test.ts` | API 客户端和错误类测试：ApiMessage、ApiRequest、StreamCallbacks 等 |
| `auth-manager.test.ts` | 认证管理器接口测试：IAuthManager 接口方法 |

### 测试覆盖

```text
ModelRegistry Tests (16 cases)
├── Singleton pattern (getInstance, _resetInstance)
├── Provider registration/removal
├── Model list management
├── Find model by ID across providers
├── Find provider by model ID
└── Duplicate prevention

ProviderFactoryRegistry Tests (11 cases)
├── Singleton pattern
├── Factory registration/removal
├── Enabled/disabled filtering
├── getAllFactories, count, clear
└── createProviderFactory utility

Models Tests (9 cases)
├── CONFIG_SECTION constant
├── ModelCapabilities (toolCalling, imageInput, thinking)
└── ModelDefinition structure and optional fields

Client Tests (40+ cases)
├── API Error Classes (ApiError, AuthenticationError, etc.)
├── ApiMessage formats (user, assistant, tool, system)
├── ApiToolCall, ApiTool, ApiRequest structures
├── ApiUsage, StreamCallbacks interfaces
└── IApiClient interface

IAuthManager Tests (10 cases)
├── getApiKey, hasApiKey, setApiKey, deleteApiKey
└── Edge cases (empty string, whitespace trimming)
```

### 运行测试

1. **VS Code 调试面板**
     - 选择 "Run Tests" 配置
     - 按 `F5` 开始调试测试

2. **命令行**

   ```bash
   npm run test:compile  # 编译
   npm run test         # 运行测试
   ```

### 编写新测试

测试使用 Mocha 框架 + VS Code Test Electron：

```typescript
// src/test/myfeature.test.ts
import * as assert from 'assert';
import { MyClass } from '../core/myfeature';

suite('MyClass', () => {
  test('should do something', () => {
    const instance = new MyClass();
    assert.strictEqual(instance.method(), expected);
  });
});
```

### 测试注意事项

- 测试文件必须以 `.test.ts` 结尾
- 放在 `src/test/` 目录下
- 运行前需先编译：`npm run test:compile`
- 测试在 VS Code 扩展主机环境中运行，可使用 VS Code API
- 每个测试套件使用 `setup` 和 `teardown` 进行清理
- 单例类提供 `_resetInstance()` 方法用于测试隔离

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

# 运行测试
npm run test

# 编译测试
npm run test:compile

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
