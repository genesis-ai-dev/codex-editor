// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { NotebookKernel } from './outputController';
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log('Ryders extension is now active!');

  // Regular kernel
  context.subscriptions.push(new NotebookKernel());
  // Kernel for interactive window
  context.subscriptions.push(new NotebookKernel(true));
}

// This method is called when your extension is deactivated
export function deactivate() { }
