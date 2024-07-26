// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import simpleGit, { SimpleGit } from 'simple-git';

const outputChannel = vscode.window.createOutputChannel('Copy GitHub Link');

export function activate(context: vscode.ExtensionContext) {
	const disposableCopy = vscode.commands.registerCommand('copy-github-link.copyGitHubLink', () => {
		// outputChannel.show();

		showGitHubLink();

		// Don't hide the output channel, it will close the "Output" panel.
		// outputChannel.hide();
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
			console.error(error);
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

	// // get the latest commit hash for the line
	// const result = await getLatestCommitForSnippet(filePath, snippet)
	// if (!result.commitHash || !result.lineNumberRange) {
	// 	throw new Error('Could not find commit hash or line number range');
	// }
	// const commitHash = result.commitHash as string;
	// const lineNumberRange = result.lineNumberRange as [number, number];

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

	var remoteName = remote.split(':')[0];
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

	// git remote show upstream
	const content = await git.raw([
		'remote',
		'show',
		remoteName
	]);
	// example match: "HEAD branch: master"
	const headBranchMatch = content.match(/HEAD branch: (.+)/);
	if (!headBranchMatch) {
		throw new Error('Could not determine HEAD branch');
	}
	const headBranch = headBranchMatch[1];

	// Get the commit id of the HEAD branch.
	// We choose the "HEAD" since some code may comes from long time ago, we don't want to
	// share a link N years ago.
	const headCommit = await git.revparse([remoteName + '/' + headBranch]);

	const lineNumberRange = await getLineNumberRangeForSnippet(relativePath, headCommit, snippet);
	if (!lineNumberRange) {
		throw new Error('Could not find line number range');
	}
	outputChannel.appendLine(`lineNumberRange at commit ${headCommit}: ${lineNumberRange}`);

	const [startLine, endLine] = lineNumberRange;
	var gitHubLink = `https://github.com/${owner}/${repo}/blob/${headCommit}/${relativePath}#L${startLine}`;
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
	outputChannel.appendLine(`getLineNumberRangeForSnippet, args: relativePath: ${relativePath}, commit: ${commit}, snippet: ${snippet}`);

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

		var candidates: [number, number][] = [];
		for (let i = 0; i < fileLines.length; i++) {
			// Check if the snippet matches the lines at position i
			if (fileLines.slice(i, i + snippetLines.length).join('\n').includes(snippet)) {
				startLine = i + 1; // Lines are 1-indexed
				endLine = startLine + snippetLines.length - 1;
				candidates.push([startLine, endLine]);
			}
		}

		if (candidates.length !== 1) {
			outputChannel.appendLine(`Found ${candidates.length} candidates for snippet: ${snippet}, candidates: ${candidates}`);
			throw new Error('Found multiple candidates for snippet');
		}

		return candidates[0];
	} catch (error) {
		outputChannel.appendLine(`Error reading file: ${error}`);
		return undefined;
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
