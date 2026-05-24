/** VS Code configuration section prefix */
export const CONFIG_SECTION = 'copilot-models';


/**
 * Model capabilities definition
 */
export interface ModelCapabilities {
	/** Whether tool calling is supported */
	toolCalling: boolean;
	/** Whether image input is supported */
	imageInput: boolean;
	/** Whether thinking mode (reasoning) is supported */
	thinking: boolean;
}

/**
 * Model definition interface
 */
export interface ModelDefinition {
	/** Model unique identifier (ID in VS Code) */
	id: string;
	/** Model display name */
	name: string;
	/** Model family (e.g. deepseek, openai) */
	family: string;
	/** Model version */
	version: string;
	/** Model detail description */
	detail: string;
	/** Maximum input tokens */
	maxInputTokens: number;
	/** Maximum output tokens */
	maxOutputTokens: number;
	/** Model capabilities */
	capabilities: ModelCapabilities;
	/** Whether thinking parameter is required */
	requiresThinkingParam?: boolean;
}

