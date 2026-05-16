import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './index');

		// Set NODE_PATH so test modules can find dependencies
		const extensionTestsEnv: Record<string, string> = {
			NODE_PATH: path.resolve(__dirname, '../../node_modules'),
		};

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			extensionTestsEnv,
		});
	} catch (error) {
		console.error('Failed to run tests:', error);
		process.exit(1);
	}
}

main();
