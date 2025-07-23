// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import simpleGit, { SimpleGit } from "simple-git";

const outputChannel = vscode.window.createOutputChannel("Copy GitHub Link");

export function activate(context: vscode.ExtensionContext) {
  const disposableCopy = vscode.commands.registerCommand(
    "copy-github-link.copyGitHubLink",
    () => {
      copyGitHubLink();
    }
  );

  const disposableOpen = vscode.commands.registerCommand(
    "copy-github-link.openInGitHub",
    () => {
      openInGitHub();
    }
  );

  context.subscriptions.push(disposableCopy, disposableOpen);
}

async function copyGitHubLink() {
  try {
    const link = await getGitHubLink(true, false);
    vscode.window.showInformationMessage(`GitHub Link copied: ${link}`);
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(error.message);
      console.error(error);
    } else {
      vscode.window.showErrorMessage("An unknown error occurred");
    }
  }
}

async function openInGitHub() {
  try {
    const link = await getGitHubLink(false, true);
    vscode.window.showInformationMessage(`Opened in GitHub: ${link}`);
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(error.message);
      console.error(error);
    } else {
      vscode.window.showErrorMessage("An unknown error occurred");
    }
  }
}

async function detectMainBranch(
  git: SimpleGit,
  remoteName: string
): Promise<string> {
  // First try to get the remote HEAD branch
  try {
    const content = await git.raw(["remote", "show", remoteName]);
    const headBranchMatch = content.match(/HEAD branch: (.+)/);
    if (headBranchMatch) {
      return headBranchMatch[1];
    }
  } catch (error) {
    outputChannel.appendLine(`Error getting remote info: ${error}`);
  }

  // Fall back to checking common main branch names in the local repo
  const commonBranches = ["main", "master", "develop", "dev", "trunk"];
  for (const branch of commonBranches) {
    try {
      await git.revparse(["--verify", `refs/heads/${branch}`]);
      outputChannel.appendLine(`Found local branch: ${branch}`);
      return branch;
    } catch (error) {
      // Branch doesn't exist, continue to next
    }
  }

  // If no common branches found, try to get the current branch
  try {
    const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);
    if (currentBranch !== "HEAD") {
      return currentBranch;
    }
  } catch (error) {
    // Ignore error
  }

  // Last resort - use "main" as default
  return "main";
}

async function getGitHubLink(
  copyToClipboard: boolean = false,
  openInBrowser: boolean = false
): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("No active editor found");
  }

  const filePath = editor.document.fileName;

  // get the git project that contains the file
  var git: SimpleGit | undefined;
  for (const project of gitProjects) {
    if (filePath.startsWith(project.rootPath)) {
      git = project.git;
      break;
    }
  }
  if (!git) {
    throw new Error("No git project found");
  }

  // get relative path
  const relativePath = vscode.workspace.asRelativePath(filePath, false);

  // const currentLineNumber = editor.selection.active.line + 1;
  const selection = editor.selection;
  var startLine = selection.start.line + 1; // Convert to 1-based line numbers
  var endLine = selection.end.line + 1;

  // get content of the selected lines, and remove the starting and trailing whitespaces
  const snippet = editor.document
    .getText(
      new vscode.Range(selection.start.line, 0, selection.end.line + 1, 0)
    )
    .trim();

  // const snippet = vscode.window.activeTextEditor?.document.lineAt(startLine - 1).text;
  if (!snippet) {
    throw new Error("No content found at line number");
  }

  // get all git remotes
  var remotes = await getGitRemotes(git);
  remotes = sortRemotes(remotes);
  outputChannel.appendLine(`remotes: ${remotes}`);

  const remote = remotes[0];
  outputChannel.appendLine(`remote: ${remote}`);

  const remoteName = remote.split(": ")[0];
  const remoteUrl = remote.split(": ")[1];

  const [owner, repo] = getMetaInfo(remoteUrl);

  // Detect the main branch name
  const mainBranch = await detectMainBranch(git, remoteName);
  outputChannel.appendLine(`Using main branch: ${mainBranch}`);

  // Get the HEAD commit hash of the main branch
  const headCommit = await git.revparse([
    `refs/remotes/${remoteName}/${mainBranch}`,
  ]);
  outputChannel.appendLine(`Using HEAD commit: ${headCommit}`);

  // For commit-based links, we use the current selection line numbers directly
  // since we're linking to a specific commit version of the file
  var lines = `L${startLine}`;
  if (endLine - startLine > 0) {
    lines += `-L${endLine}`;
  }

  const gitHubLink = `https://github.com/${owner}/${repo}/blob/${headCommit}/${relativePath}#${lines}`;

  outputChannel.appendLine(`lines' content:\n${snippet}`);
  outputChannel.appendLine(`github link: ${gitHubLink}`);
  outputChannel.appendLine(`relative path: ${relativePath}#${lines}`);

  // copy to clipboard if requested
  if (copyToClipboard) {
    vscode.env.clipboard.writeText(gitHubLink);
  }
  // open in browser if requested
  if (openInBrowser) {
    vscode.env.openExternal(vscode.Uri.parse(gitHubLink));
  }
  return gitHubLink;
}

interface GitProject {
  rootPath: string;
  git: SimpleGit;
}

function initGitProjects(): GitProject[] {
  const gitProjects: GitProject[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folders found");
  }

  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const git = simpleGit().cwd(rootPath);
    gitProjects.push({ rootPath, git });
  }

  return gitProjects;
}

const gitProjects = initGitProjects();

async function getGitRemotes(git: SimpleGit): Promise<string[]> {
  const remotes = await git.getRemotes(true);

  outputChannel.appendLine(
    `getGitRemotes, remotes: ${JSON.stringify(remotes)}`
  );
  return remotes.map((remote) => `${remote.name}: ${remote.refs.fetch}`);
}

function sortRemotes(remotes: string[]): string[] {
  var preferred = ["upstream", "origin"];
  // sort remotes by preferred order
  remotes.sort((a, b) => {
    var aIndex = preferred.indexOf(a.split(":")[0]);
    if (aIndex === -1) {
      // if not in preferred list, put it at the end
      aIndex = 1000;
    }

    var bIndex = preferred.indexOf(b.split(":")[0]);
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
    throw new Error("Could not determine owner from remote url");
  }

  if (repo === "") {
    throw new Error("Could not determine repo from remote url");
  }

  return [owner, repo];
}

// This method is called when your extension is deactivated
export function deactivate() {}
