// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import simpleGit, { SimpleGit } from 'simple-git';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "copy-github-link" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('copy-github-link.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from copy-github-link!');
	});

	context.subscriptions.push(disposable);

	const disposableCopy = vscode.commands.registerCommand('copy-github-link.copyGitHubLink', () => {
		showGitHubLink();
	});

	context.subscriptions.push(disposableCopy);
}

async function showGitHubLink() {
	try {
		// Await the async function getGitHubLink
		const link = await getGitHubLink();
		vscode.window.showInformationMessage(`GitHub Link: ${link}`);
	} catch (error) {
		// Handle errors thrown by getGitHubLink
		if (error instanceof Error) {
			vscode.window.showErrorMessage(error.message);
		} else {
			vscode.window.showErrorMessage('An unknown error occurred');
		}
	}
}

async function getGitHubLink(): Promise<string> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		throw new Error('No active editor found');
	}

	// get relative path
	const filePath = editor.document.fileName;
	const relativePath = vscode.workspace.asRelativePath(filePath, false);

	const currentLineNumber = editor.selection.active.line + 1;

	// get content of the current line
	const snippet = vscode.window.activeTextEditor?.document.lineAt(currentLineNumber - 1).text;
	if (!snippet) {
		throw new Error('No content found at line number');
	}

	// get the latest commit hash for the line
	const result = await getLatestCommitForSnippet(filePath, snippet)
	const commitHash = result.commitHash as string;
	const lineNumberRange = result.lineNumberRange as [number, number];

	// get all git remotes
	const remotes = await getGitRemotes().then(remotes => {
		// throw error if no remotes found
		if (remotes.length === 0) {
			throw new Error('No git remotes found');
		}

		var preferred = ['upstream', 'origin'];
		// sort remotes by preferred order
		remotes.sort((a, b) => {
			var aIndex = preferred.indexOf(a.split(':')[0]);
			if (aIndex === -1) {
				// if not in preferred list, put it at the end
				aIndex = 1000;
			}

			var bIndex = preferred.indexOf(b.split(':')[0]);
			if (bIndex === -1) {
				// if not in preferred list, put it at the end
				bIndex = 1000;
			}

			return aIndex - bIndex;
		});

		return remotes;
	});

	const remote = remotes[0];

	// get owner (org/user) name
	// remote: "upstream git@github.com:cockroachdb/cockroach.git"
	// => owner: cockroachdb
	// => repo: cockroach
	// remote: "butter https://github.com/msbutler/cockroach"
	// => owner: msbutler
	// => repo: cockroach
	const sshRegex = /^.+git@github\.com:(.+?)\/(.+?)\.git$/;
	const httpsRegex = /^.+https:\/\/github\.com\/(.+?)\/(.+?)$/;

	var owner = "";
	var repo = "";
	let match = remote.match(sshRegex);
	if (match) {
		owner = match[1];
		repo = match[2];
	}

	match = remote.match(httpsRegex);
	if (match) {
		owner = match[1];
		repo = match[2];
	}

	if (owner === "") {
		throw new Error('Could not determine owner from remote url');
	}

	if (repo === "") {
		throw new Error('Could not determine repo from remote url');
	}
	const [startLine, endLine] = lineNumberRange;
	var gitHubLink = `https://github.com/${owner}/${repo}/blob/${commitHash}/${relativePath}#L${startLine}`;
	if (endLine - startLine > 1) {
		gitHubLink += `-L${endLine}`;
	}
	vscode.window.showInformationMessage(`GitHub Link: ${gitHubLink}`);
	// copy to clipboard
	vscode.env.clipboard.writeText(gitHubLink);
	// open in browser
	vscode.env.openExternal(vscode.Uri.parse(gitHubLink));
	return gitHubLink;
}

function initGit(): SimpleGit {
	const git = simpleGit();

	const repoPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!repoPath) {
		throw new Error('No workspace folder found');
	}
	return git.cwd(repoPath)
}

const git = initGit();

async function getGitRemotes(): Promise<string[]> {
	const remotes = await git.getRemotes(true);
	return remotes.map(remote => `${remote.name}: ${remote.refs.fetch}`);
}

async function getLineNumberRangeForSnippet(relativePath: string, commit: string, snippet: string): Promise<[number, number] | undefined> {
	try {
		// Read the file content at the specified revision
		// git show REVISION:path/to/file
		const content = await git.raw([
			'show',
			`${commit}:${relativePath}`
		]);

		// Read the file content
		// const content = await vscode.workspace.fs.readFile(vscode.Uri.file(`${filePath}`));
		const fileContent = content.toString();

		// Find the start and end line of the snippet
		const snippetLines = snippet.split('\n');
		const fileLines = fileContent.split('\n');

		let startLine = -1;
		let endLine = -1;

		for (let i = 0; i < fileLines.length; i++) {
			// Check if the snippet matches the lines at position i
			if (fileLines.slice(i, i + snippetLines.length).join('\n') === snippet) {
				startLine = i + 1; // Lines are 1-indexed
				endLine = startLine + snippetLines.length - 1;
				break;
			}
		}

		if (startLine === -1 || endLine === -1) {
			console.error('Snippet not found in file.');
			return undefined;
		}

		return [startLine, endLine];
	} catch (error) {
		console.error('Error reading file:', error);
		return undefined;
	}
}

async function getLatestCommitForSnippet(filePath: string, snippet: string): Promise<{ commitHash: string | undefined, lineNumberRange: [number, number] | undefined }> {
	console.log('filePath:', filePath);
	console.log('Getting latest commit for snippet:', snippet);

	const relativePath = vscode.workspace.asRelativePath(filePath, false);
	console.log('relativePath:', relativePath);

	try {
		// Get the line number range for the snippet
		const lineNumberRange = await getLineNumberRangeForSnippet(relativePath, "HEAD", snippet);
		if (!lineNumberRange) {
			return { commitHash: undefined, lineNumberRange: undefined };
		}

		const [startLine, endLine] = lineNumberRange;
		console.log('lineNumberRange at HEAD:', lineNumberRange);

		// Use git.log -L to find the latest commit that modified the line range
		const logOutput = await git.raw([
			'log',
			`-L${startLine},${endLine}:${relativePath}`
		]);

		// Parse the output to get the latest commit hash
		const lines = logOutput.split('\n');
		const commitLines = lines.filter(line => line.startsWith('commit '));

		if (commitLines.length > 0) {
			const latestCommitLine = commitLines[0];
			const commitHash = latestCommitLine.replace('commit ', '').trim();

			// Get the line number range for the snippet
			const lineNumberRange = await getLineNumberRangeForSnippet(relativePath, commitHash, snippet);
			if (!lineNumberRange) {
				return { commitHash: undefined, lineNumberRange: undefined };
			}
			console.log(`lineNumberRange at commit ${commitHash}:`, lineNumberRange);
			return { commitHash, lineNumberRange };
		} else {
			console.log('No commits found for the specified line range.');
			return { commitHash: undefined, lineNumberRange: undefined };
		}
	} catch (error) {
		console.error('Error getting commit log:', error);
		return { commitHash: undefined, lineNumberRange: undefined };
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
