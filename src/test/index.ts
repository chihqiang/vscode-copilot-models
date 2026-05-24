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
 * Get all test files recursively from the directory
 */
function getTestFiles(testsRoot: string): string[] {
	const fs = require('fs');
	const pathModule = require('path');
	const files: string[] = [];

	function scan(dir: string): void {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = pathModule.join(dir, entry.name);
			if (entry.isDirectory()) {
				scan(fullPath);
			} else if (entry.isFile() && /\.test\.js$/.test(entry.name)) {
				files.push(fullPath);
			}
		}
	}

	scan(testsRoot);
	return files;
}
