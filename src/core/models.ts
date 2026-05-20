/** VS Code 配置节前缀 */
export const CONFIG_SECTION = 'copilot-models';


/**
 * 模型能力定义
 */
export interface ModelCapabilities {
	/** 是否支持工具调用 */
	toolCalling: boolean;
	/** 是否支持图片输入 */
	imageInput: boolean;
	/** 是否支持思考模式 (reasoning) */
	thinking: boolean;
}

/**
 * 模型定义接口
 */
export interface ModelDefinition {
	/** 模型唯一标识符 (在 VS Code 中的 ID) */
	id: string;
	/** 模型显示名称 */
	name: string;
	/** 模型家族 (如 deepseek, openai 等) */
	family: string;
	/** 模型版本 */
	version: string;
	/** 模型详细描述 */
	detail: string;
	/** 最大输入令牌数 */
	maxInputTokens: number;
	/** 最大输出令牌数 */
	maxOutputTokens: number;
	/** 模型能力 */
	capabilities: ModelCapabilities;
	/** 是否需要 thinking 参数 */
	requiresThinkingParam?: boolean;
}

