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

	// const currentLineNumber = editor.selection.active.line + 1;
	const selection = editor.selection;
	var startLine = selection.start.line;
	var endLine = selection.end.line;
	if (startLine === endLine) {
		// if only one line is selected, expand to the whole line
		endLine += 1;
	}

	// get content of the selected lines
	const snippet = editor.document.getText(new vscode.Range(startLine, 0, endLine, 0));

	// const snippet = vscode.window.activeTextEditor?.document.lineAt(startLine - 1).text;
	if (!snippet) {
		throw new Error('No content found at line number');
	}

	// get all git remotes
	var remotes = await getGitRemotes();
	remotes = sortRemotes(remotes);
	outputChannel.appendLine(`remotes: ${remotes}`);

	const remote = remotes[0];
	outputChannel.appendLine(`remote: ${remote}`);

	const remoteName = remote.split(' ')[0];
	const remoteUrl = remote.split(' ')[1];


	const [owner, repo] = getMetaInfo(remoteUrl);

	// git remote show upstream
	var lineNumberRange: [number, number][] = [];
	var headCommit = "";
	try {
		const content = await git.raw([
			'remote',
			'show',
			remoteName
		]);

		// example match: "HEAD branch: master"
		const headBranchMatch = content.match(/HEAD branch: (.+)/);
		if (!headBranchMatch) {
			throw new Error('Could not find remote HEAD branch');
		}
		const headBranch = headBranchMatch[1];

		// Get the commit id of the HEAD branch.
		// We choose the "HEAD" since some code may comes from long time ago, we don't want to
		// share a link N years ago.
		headCommit = await git.revparse(remoteName + '/' + headBranch);
	} catch (error) {
		// Failed to access remote repo, use information from local repo
		outputChannel.appendLine(`Error getting remote info: ${error}`);

		const headBranch = "master";
		headCommit = await git.revparse(headBranch);
	}

	var lineNumberRange = await getLineNumberRangeForSnippet(relativePath, headCommit, snippet);
	outputChannel.appendLine(`lineNumberRange at commit ${headCommit}: ${lineNumberRange}`);

	var gitHubLink = "";
	if (lineNumberRange.length === 1) {
		const [commitStartLine, commitEndLine] = lineNumberRange[0];
		gitHubLink = `https://github.com/${owner}/${repo}/blob/${headCommit}/${relativePath}#L${commitStartLine}`;
		if (commitEndLine - commitStartLine > 1) {
			gitHubLink += `-L${commitEndLine}`;
		}
	} else {
		// multiple candidates, use local line numbers
		gitHubLink = `https://github.com/${owner}/${repo}/blob/${headCommit}/${relativePath}#L${startLine}`;
		if (endLine - startLine > 1) {
			gitHubLink += `-L${endLine}`;
		}
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
	return git.cwd(repoPath);
}

const git = initGit();

async function getGitRemotes(): Promise<string[]> {
	const remotes = await git.getRemotes(true);
	return remotes.map(remote => `${remote.name}: ${remote.refs.fetch}`);
}

function sortRemotes(remotes: string[]): string[] {
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
}

function getMetaInfo(url: string): [owner: string, repo: string] {
	outputChannel.appendLine(`getMetaInfo, url: ${url}`);

	// get owner (org/user) name
	// remote: "git@github.com:cockroachdb/cockroach.git"
	// => owner: cockroachdb
	// => repo: cockroach
	// remote: "https://github.com/msbutler/cockroach.git"
	// => owner: msbutler
	// => repo: cockroach
	const sshRegex = /^git@github\.com:(.+?)\/(.+?)\.git$/;
	const httpsRegex = /^https:\/\/github\.com\/(.+?)\/(.+?)\.git$/;

	var owner = "";
	var repo = "";
	let match = url.match(sshRegex);
	if (match) {
		owner = match[1];
		repo = match[2];
	}

	match = url.match(httpsRegex);
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

	return [owner, repo];
}

/**
 * Get the line number range of the snippet in the file at the specified commit. This function
 * doesn't need remote access to the repository.
 */
async function getLineNumberRangeForSnippet(relativePath: string, commit: string, snippet: string): Promise<[number, number][]> {
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

		return candidates;
	} catch (error) {
		outputChannel.appendLine(`Error reading file: ${error}`);
		return [];
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
