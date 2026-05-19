# Copilot Models - Developer Guide

## 项目架构

```text
src/
├── core/                           # 核心模块
│   ├── interfaces.ts              # 核心接口定义
│   ├── consts.ts                   # 常量定义
│   ├── registry.ts                 # 模型注册表 (ModelRegistry 单例)
│   ├── provider-registry.ts        # 提供者工厂注册表 (ProviderFactoryRegistry)
│   └── logger.ts                   # 日志模块 (createProviderLogger)
├── providers/                      # 模型提供者
│   ├── base/                       # 基础抽象类和工具
│   │   ├── model-provider.ts       # BaseModelProvider - 模型提供商基类 (API Key 管理、客户端创建)
│   │   ├── chat-provider.ts       # BaseChatProvider - Chat Provider 基类 (消息转换、流式请求)
│   │   ├── client.ts               # BaseApiClient - API 客户端基类 (使用 OpenAI SDK 处理流式请求)
│   │   ├── auth-manager.ts         # BaseAuthManager - 认证管理基类
│   │   ├── provider-factory.ts     # 通用 Provider 工厂函数 (消除重复代码)
│   │   └── index.ts
│   ├── deepseek/                   # DeepSeek 实现
│   │   ├── models.ts               # 模型定义 (DeepSeek V4 Flash/Pro)
│   │   ├── client.ts               # DeepSeekClient
│   │   ├── provider.ts             # 使用通用工厂创建 DeepSeek Provider
│   │   └── index.ts
│   ├── bigmodel/                   # 智谱 AI 实现
│   │   ├── models.ts               # 模型定义 (GLM-5.1/5-Turbo/5)
│   │   ├── client.ts               # BigModelClient
│   │   ├── provider.ts             # 使用通用工厂创建 BigModel Provider
│   │   └── index.ts
│   └── index.ts                    # 提供者统一导出 + registerAllProviders()
├── extension.ts                    # 扩展入口
└── test/                           # 测试文件
    ├── index.ts                    # 测试入口
    ├── runTest.ts                  # 测试运行器
    ├── extension.test.ts           # 扩展集成测试
    ├── registry.test.ts            # ModelRegistry 单元测试
    ├── provider-registry.test.ts   # ProviderFactoryRegistry 单元测试
    ├── interfaces.test.ts          # 接口和数据结构测试
    └── utils.test.ts               # 工具函数测试
```

## 配置与 API Key

- API 密钥通过命令面板设置：使用 `Copilot Models: Set API Key`，
  选择提供者并输入密钥。密钥存储在 VS Code `SecretStorage` 中。
- 扩展提供以下设置项（示例）：
  - `copilot-models.deepseek.enabled`（是否启用 DeepSeek）
  - `copilot-models.deepseekBaseUrl`（DeepSeek API 基础地址）
  - `copilot-models.bigmodel.enabled`（是否启用 BigModel）
  - `copilot-models.bigmodelBaseUrl`（BigModel API 基础地址）
  - `copilot-models.modelIdOverrides`（模型 ID 覆盖映射）
  - `copilot-models.maxTokens`（最大生成令牌，0 表示无限制）
  - `copilot-models.debugMode`（日志级别：`minimal|metadata|verbose`）

## 核心接口

| 接口 | 说明 |
| :----- | :----- |
| `IModelProvider` | 模型提供商接口，定义获取 API 密钥、模型列表等方法 |
| `IApiClient` | API 客户端接口，定义流式请求方法 |
| `IChatProvider<T>` | Chat Provider 接口，扩展 VS Code LanguageModelChatProvider |
| `ModelDefinition` | 模型定义结构，包含 ID、名称、能力等 |
| `ProviderConfig` | 提供商配置信息 |
| `IProviderFactory` | 提供者工厂接口，用于动态注册新提供商 |

### 类型安全

项目采用 **严格的类型系统**，确保代码质量和可维护性：

- ✅ `BaseChatProvider` 实现 `IChatProvider<vscode.LanguageModelChatInformation>`
- ✅ `BaseModelProvider` 实现 `IModelProvider`
- ✅ 消除所有 `as unknown as` 类型断言
- ✅ 泛型支持，确保类型推导准确

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

#### 方式一：使用通用工厂函数（推荐）

使用 `createGenericProviderFactory` 可以快速创建 Provider，无需编写重复代码：

```typescript
// providers/example/provider.ts
import { createGenericProviderFactory } from '../base/provider-factory';
import { EXAMPLE_MODELS } from './models';
import { createExampleClient } from './client';

const { register, GenericChatProvider } = createGenericProviderFactory({
  providerId: 'example',
  providerName: 'Example',
  defaultBaseUrl: 'https://api.example.com',
  models: EXAMPLE_MODELS,
  apiKeyPrompt: 'Enter your Example API Key',
  apiKeyPlaceholder: 'example-sk-...',
  createClient: createExampleClient,
  // 可选：自定义思考参数转换
  convertThinkingParams: (request, effort) => {
    if (effort !== 'none') {
      (request as any).reasoning_effort = effort;
    }
  },
});

export class ExampleChatProvider extends GenericChatProvider {}

export function registerExampleProviderFactory(): void {
  register();
}
```

#### 方式二：使用基类继承

使用 `BaseModelProvider` + `BaseChatProvider` 基类，可快速新增一个符合 Copilot Chat 的第三方模型提供者。

#### 步骤

1. 在 `providers/` 下创建新目录（如 `providers/example/`）
2. 创建模型定义 `models.ts`
3. 创建 API 客户端，继承 `BaseApiClient`
4. 创建 Provider 配置 + `BaseModelProvider` 子类
5. 创建 ChatProvider，继承 `BaseChatProvider`
6. 实现 `IProviderFactory` 接口
7. 在 `providers/<vendor>/index.ts` 中导出模块
8. 在 `src/providers/index.ts` 的 `registerAllProviders()` 中注册工厂

#### 示例代码

```typescript
// providers/example/models.ts
import { ModelDefinition } from '../../core/interfaces';

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
```

```typescript
// providers/example/client.ts
import { createApiClient } from '../base/client';
import type { IApiClient } from '../../core/interfaces';

export function createExampleClient(
  baseUrl: string,
  apiKey: string,
): IApiClient {
  return createApiClient({
    baseUrl,
    apiKey,
    providerName: 'Example',
  });
}
```

```typescript
// providers/example/provider.ts
import { createGenericProviderFactory } from '../base/provider-factory';
import { EXAMPLE_MODELS } from './models';
import { createExampleClient } from './client';

// 使用通用工厂函数，消除重复代码
const { register, GenericChatProvider } = createGenericProviderFactory({
  providerId: 'example',
  providerName: 'Example',
  defaultBaseUrl: 'https://api.example.com',
  models: EXAMPLE_MODELS,
  apiKeyPrompt: 'Enter your Example API Key',
  apiKeyPlaceholder: 'example-sk-...',
  createClient: createExampleClient,
});

export class ExampleChatProvider extends GenericChatProvider {}

export function registerExampleProviderFactory(): void {
  register();
}
```

`src/providers/index.ts` 中的内置注册逻辑示例如下：

```typescript
export * from './base';
export * from './deepseek';
export * from './bigmodel';

import { registerDeepSeekProviderFactory } from './deepseek';
import { registerBigModelProviderFactory } from './bigmodel';

export function registerAllProviders(): void {
  registerDeepSeekProviderFactory();
  registerBigModelProviderFactory();
}
```

**优化说明**：

- ✅ 使用静态 `import` 替代动态 `require()`，提高代码可维护性
- ✅ 类型推导更准确，支持更好的 IDE 智能提示

#### 基类功能一览

| 基类 | 功能 |
| :----- | :----- |
| `BaseModelProvider` | API Key 管理、配置读取、模型 ID 覆盖、客户端创建 |
| `BaseChatProvider` | 消息转换、角色映射、流式回调、请求发送、API Key 配置、模型选择器 |
| `BaseApiClient` | 基于 OpenAI SDK 的流式请求处理、错误处理、取消令牌支持、工具调用处理 |

#### 错误处理

客户端提供完善的错误处理机制，支持以下错误类型：

| 错误类 | 状态码 | 说明 |
| :----- | :----- | :----- |
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
pnpm run test

# 仅编译测试（不运行）
pnpm run test:compile
```

### 测试文件结构

| 文件 | 说明 |
| :----- | :----- |
| `registry.test.ts` | ModelRegistry 单例测试：提供者注册/注销、模型列表管理 |
| `provider-registry.test.ts` | ProviderFactoryRegistry 测试：工厂注册、 |
| | 启用/禁用状态过滤 |
| `interfaces.test.ts` | 接口和数据结构测试： |
| | ModelDefinition、ApiMessage、StreamCallbacks 等 |
| `utils.test.ts` | 工具函数测试：safeStringify、sanitizeForLog、isSensitiveKey |
| `extension.test.ts` | 扩展集成测试：命令注册、配置验证、语言模型提供者声明 |

### 测试覆盖

```text
Registry Tests (11 cases)
├── Singleton pattern
├── Provider registration/removal
├── Model list management
├── Find by ID
└── Duplicate prevention

ProviderFactoryRegistry Tests (9 cases)
├── Factory registration
├── Enabled/disabled filtering
└── Duplicate prevention

Interfaces Tests (10+ cases)
├── ModelDefinition structure
├── ModelCapabilities
├── ApiMessage (user/assistant/system/tool)
├── ApiRequest format
└── StreamCallbacks

Utils Tests (15+ cases)
├── sanitizeForLog (sensitive data redaction)
└── isSensitiveKey patterns

Extension Tests (5 cases)
├── VS Code module availability
├── Command registration
├── Configuration defaults
└── Language model provider declaration
```

### 运行测试

1. **VS Code 调试面板**
     - 选择 "Run Tests" 配置
     - 按 `F5` 开始调试测试

2. **命令行**

   ```bash
   pnpm run test:compile  # 编译
   pnpm run test          # 运行测试
   ```

### 编写新测试

测试使用 Mocha 框架 + VS Code Test Electron：

```typescript
// src/test/myfeature.test.ts
import * as assert from 'assert';
import { MyClass } from '../core/myclass';

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
- 运行前需先编译：`pnpm run test:compile`
- 测试在 VS Code 扩展主机环境中运行，可使用 VS Code API

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
