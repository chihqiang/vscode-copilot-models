import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 10000,
	});

	// testsRoot is out/ directory
	const testsRoot = path.resolve(__dirname);

	return new Promise((resolve, reject) => {
		// Get all test files directly from out/test/ directory
		const testFiles = getTestFiles(testsRoot);

		if (testFiles.length === 0) {
			console.warn('No test files found in', testsRoot);
		}

		// Add files to the test suite
		testFiles.forEach((f: string) => mocha.addFile(f));

		try {
			// Run the tests
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}

/**
 * Get all test files directly from the directory (no recursion)
 */
function getTestFiles(testsRoot: string): string[] {
	const fs = require('fs');
	const pathModule = require('path');
	const files: string[] = [];

	const entries = fs.readdirSync(testsRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isFile() && /\.test\.js$/.test(entry.name)) {
			files.push(pathModule.join(testsRoot, entry.name));
		}
	}

	return files;
}
