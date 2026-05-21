import * as assert from 'assert';
import * as vscode from 'vscode';
import { ModelRegistry } from '../core/model-registry';
import { ProviderFactoryRegistry } from '../core/provider-registry';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	setup(() => {
		// Clear registries before each test
		ModelRegistry.getInstance().clear();
		ProviderFactoryRegistry.getInstance().clear();
	});

	teardown(() => {
		ModelRegistry.getInstance().clear();
		ProviderFactoryRegistry.getInstance().clear();
	});

	test('Extension should be defined', () => {
		assert.ok(vscode, 'vscode module should be available');
		assert.ok(vscode.workspace, 'workspace should be available');
		assert.ok(vscode.window, 'window should be available');
	});

	test('Commands should be registered', async () => {
		// Get all registered commands
		const commands = await vscode.commands.getCommands(true);

		// Check for expected commands
		assert.ok(commands.includes('copilot-models.setApiKey'), 'setApiKey command should be registered');
		assert.ok(commands.includes('copilot-models.clearApiKey'), 'clearApiKey command should be registered');
		assert.ok(commands.includes('copilot-models.openSettings'), 'openSettings command should be registered');
		assert.ok(commands.includes('copilot-models.refreshModels'), 'refreshModels command should be registered');
	});

	test('Extension configuration should exist', () => {
		const config = vscode.workspace.getConfiguration('copilot-models');

		assert.ok(config, 'copilot-models configuration should exist');

		// Check default values
		assert.strictEqual(
			config.get<string>('deepseek.baseUrl'),
			'https://api.deepseek.com',
			'deepseek.baseUrl should have default value'
		);

		assert.deepStrictEqual(
			config.get<Record<string, string>>('modelIdOverrides'),
			{},
			'modelIdOverrides should default to empty object'
		);

		assert.strictEqual(
			config.get<number>('maxTokens'),
			0,
			'maxTokens should default to 0'
		);
	});

	test('Language model chat provider should be registered', () => {
		// Check that deepseek provider is declared in package.json
		const packageJson = vscode.extensions.getExtension('chihqiang.vscode-copilot-models');
		assert.ok(packageJson, 'Extension should be available');

		const contributes = packageJson.packageJSON.contributes;
		assert.ok(contributes.languageModelChatProviders, 'languageModelChatProviders should be defined');

		const providers = contributes.languageModelChatProviders as Array<{ vendor: string; displayName: string }>;
		assert.ok(providers.length > 0, 'At least one provider should be declared');

		const deepseekProvider = providers.find((p) => p.vendor === 'deepseek');
		assert.ok(deepseekProvider, 'DeepSeek provider should be declared');
		assert.strictEqual(deepseekProvider.displayName, 'DeepSeek');
	});

	test('Logger should be functional', async () => {
		// Test that logging doesn't throw errors
		const channel = vscode.window.createOutputChannel('Test Channel');
		assert.ok(channel, 'Output channel should be created');

		channel.appendLine('Test log message');
		channel.append('Test log message without newline');

		// Clear the channel
		channel.clear();
		assert.ok(true, 'Logger channel operations should work');

		// Dispose the channel
		channel.dispose();
	});
});
