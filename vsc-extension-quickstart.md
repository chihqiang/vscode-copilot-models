# Copilot Models - Developer Guide

## 项目架构

```
src/
├── core/                           # 核心模块
│   ├── interfaces.ts              # 核心接口定义 (IModelProvider, IApiClient, ModelDefinition 等)
│   ├── consts.ts                   # 常量定义
│   ├── registry.ts                 # 模型注册表 (ModelRegistry 单例)
│   ├── provider-registry.ts        # 提供者工厂注册表 (ProviderFactoryRegistry)
│   └── logger.ts                   # 日志模块 (分类日志输出)
├── providers/                      # 模型提供者
│   ├── base/                       # 基础抽象类
│   │   ├── auth-manager.ts         # BaseAuthManager - 认证管理基类
│   │   ├── client.ts               # BaseApiClient - API 客户端基类 (SSE 流式处理)
│   │   ├── chat-provider.ts       # BaseChatProvider - Chat Provider 基类
│   │   └── index.ts
│   ├── deepseek/                  # DeepSeek 实现
│   │   ├── models.ts              # 模型定义 (DeepSeek V4 Flash/Pro)
│   │   ├── client.ts               # DeepSeekClient
│   │   ├── provider.ts             # DeepSeekProviderFactory + DeepSeekChatProvider
│   │   └── index.ts
│   └── index.ts                    # 提供者统一导出 + registerAllProviders()
├── extension.ts                    # 扩展入口
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
| `IProviderFactory` | 提供者工厂接口，用于动态注册新提供商 |

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
5. 实现 `IProviderFactory` 接口
6. 在 `providers/index.ts` 中导出并注册
7. 在 `package.json` 的 `copilot-models.enabledProviders` 配置中添加新的 providerId

**示例代码：**

```typescript
// 1. models.ts - 定义模型列表
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

  // 添加新提供商
  const { registerOpenAIProviderFactory } = require('./openai');
  registerOpenAIProviderFactory();
}
```

### 配置控制

可在 `package.json` 中通过配置控制提供商启用状态：

```json
{
  "copilot-models.enabledProviders": {
    "type": "array",
    "default": ["deepseek"],
    "items": { "type": "string" },
    "markdownDescription": "Enabled providers"
  }
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
