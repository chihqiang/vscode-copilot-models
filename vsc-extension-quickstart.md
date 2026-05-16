# Copilot Models - Developer Guide

## 项目架构

```
src/
├── core/                           # 核心模块
│   ├── interfaces.ts              # 核心接口定义 (IModelProvider, IApiClient, ModelDefinition 等)
│   ├── consts.ts                   # 常量定义
│   ├── registry.ts                 # 模型注册表 (ModelRegistry 单例)
│   ├── provider-registry.ts        # 提供者工厂注册表 (ProviderFactoryRegistry)
│   └── logger.ts                   # 日志模块 (createProviderLogger)
├── providers/                      # 模型提供者
│   ├── base/                       # 基础抽象类
│   │   ├── auth-manager.ts         # BaseAuthManager - 认证管理基类
│   │   ├── client.ts               # BaseApiClient - API 客户端基类 (SSE 流式处理)
│   │   ├── chat-provider.ts        # BaseChatProvider - Chat Provider 基类
│   │   └── index.ts
│   ├── deepseek/                   # DeepSeek 实现
│   │   ├── models.ts               # 模型定义 (DeepSeek V4 Flash/Pro)
│   │   ├── client.ts               # DeepSeekClient
│   │   ├── provider.ts             # DeepSeekProviderFactory + DeepSeekChatProvider
│   │   └── index.ts
│   ├── bigmodel/                   # 智谱 AI 实现
│   │   ├── models.ts               # 模型定义 (GLM-5.1/5-Turbo/5)
│   │   ├── client.ts               # BigModelClient
│   │   ├── provider.ts             # BigModelProviderFactory + BigModelChatProvider
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

## 核心接口

| 接口 | 说明 |
|:-----|:-----|
| `IModelProvider` | 模型提供商接口，定义获取 API 密钥、模型列表等方法 |
| `IApiClient` | API 客户端接口，定义流式请求方法 |
| `ModelDefinition` | 模型定义结构，包含 ID、名称、能力等 |
| `ProviderConfig` | 提供商配置信息 |
| `IProviderFactory` | 提供者工厂接口，用于动态注册新提供商 |

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
|:-----|:-----|:-------:|:-------:|
| `debug` | 详细调试信息 | ✅ 输出 | ❌ 不输出 |
| `info` | 一般信息 | ✅ 输出 | ✅ 输出 |
| `warn` | 警告信息 | ✅ 输出 | ✅ 输出 |
| `error` | 错误信息 | ✅ 输出 | ✅ 输出 |

### 环境检测

- **开发模式**：`NODE_ENV=development` 或调试会话中
- **生产模式**：插件以安装包形式运行时

## 动态注册机制

扩展使用 **ProviderFactoryRegistry** 实现动态注册，支持在不修改 `extension.ts` 的情况下添加新提供商。

### 注册流程

```
模块加载 → registerAllProviders() → 注册所有 IProviderFactory → ProviderFactoryRegistry
                                                      ↓
扩展激活 → getEnabledFactories() → 遍历注册 → vscode.lm.registerLanguageModelChatProvider()
```

### 添加新模型提供商

1. 在 `providers/` 下创建新目录（如 `providers/openai/`）
2. 创建模型定义 `models.ts`
3. 创建 API 客户端继承 `BaseApiClient`
4. 创建 Provider 继承 `BaseChatProvider`
5. 使用 `createProviderLogger` 创建日志记录器
6. 实现 `IProviderFactory` 接口
7. 在 `providers/index.ts` 中导出并注册
8. 在 `package.json` 的 `languageModelChatProviders` 中添加配置

**示例代码：**

```typescript
// 1. models.ts - 定义模型列表
import { ModelDefinition } from '../../core/interfaces';

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

export const OPENAI_PROVIDER_ID = 'openai';
export const OPENAI_CONFIG_SECTION = 'copilot-models';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// 2. provider.ts - 实现 ProviderFactory
import { IProviderFactory, ProviderFactoryRegistry } from '../../core/provider-registry';
import { createProviderLogger, logger as globalLogger } from '../../core/logger';

const logger = {
    ...createProviderLogger(OPENAI_PROVIDER_ID, 'OpenAI'),
    chat: globalLogger.chat,
    stream: globalLogger.stream,
};

export class OpenAIProviderFactory implements IProviderFactory {
  readonly providerId = OPENAI_PROVIDER_ID;
  readonly providerName = 'OpenAI';

  isEnabled(): boolean {
    const config = vscode.workspace.getConfiguration(OPENAI_CONFIG_SECTION);
    return config.get<boolean>('enabledProviders')?.includes(this.providerId) ?? false;
  }

  createChatProvider(context: vscode.ExtensionContext): OpenAIChatProvider {
    return new OpenAIChatProvider(context);
  }
}

// 注册工厂
export function registerOpenAIProviderFactory(): void {
  ProviderFactoryRegistry.getInstance().register(new OpenAIProviderFactory());
}

// 3. providers/index.ts - 统一注册
export function registerAllProviders(): void {
  const { registerDeepSeekProviderFactory } = require('./deepseek');
  registerDeepSeekProviderFactory();

  const { registerBigModelProviderFactory } = require('./bigmodel');
  registerBigModelProviderFactory();

  // 添加新提供商
  const { registerOpenAIProviderFactory } = require('./openai');
  registerOpenAIProviderFactory();
}
```

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
|:-----|:-----|
| `registry.test.ts` | ModelRegistry 单例测试：提供者注册/注销、模型列表管理 |
| `provider-registry.test.ts` | ProviderFactoryRegistry 测试：工厂注册、启用/禁用状态过滤 |
| `interfaces.test.ts` | 接口和数据结构测试：ModelDefinition、ApiMessage、StreamCallbacks 等 |
| `utils.test.ts` | 工具函数测试：safeStringify、sanitizeForLog、isSensitiveKey |
| `extension.test.ts` | 扩展集成测试：命令注册、配置验证、语言模型提供者声明 |

### 测试覆盖

```
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
├── safeStringify (Map, circular ref)
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
