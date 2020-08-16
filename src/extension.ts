// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { execSync } from "child_process";

import * as fs from "fs";
import {
  inShell,
} from "./package-manager/src/chocolatey";
import { shellExec, inOsShell, vscodeInstallPackageManager } from "./package-manager/src/packageManager";
import { Progress, TaskMessage, ErrorMsg, SuccessMsg } from "./package-manager/src/helpers";
import { Logger } from "./logger";

function installGitOsx(context: vscode.ExtensionContext): Thenable<TaskMessage> {
  if (!fs.existsSync(context.logPath)) {
    fs.mkdirSync(context.logPath);
  }
  return shellExec(`brew install git`);
}

function isGitInstalled(): Thenable<boolean> {
  return inOsShell('git --version', { disableChocoCheck: true, requiredCmd: 'git' })
    .then((result) => {
      const isInstalled = result.success && result.msg.length > 0;
      Logger.log('Git installed: ', isInstalled);
      return vscode.commands.executeCommand('setContext', 'git2go:isGitInstalled', isInstalled)
        .then(() => isInstalled);
    });
}


function installGit(context: vscode.ExtensionContext, progress: Progress): Thenable<TaskMessage> {
  return isGitInstalled()
    .then((isInstalled) => {
      if (isInstalled) {
        return SuccessMsg('Already installed');
      }
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Install Git"
        },
        () => {
          return vscodeInstallPackageManager(context, progress, 30).then((success) => {
            progress.report({ message: "Install Git", increment: 35 });
            if (success) {
              if (process.platform === "darwin") {
                return installGitOsx(context);
              } else if (process.platform === "win32") {
                vscode.window.showWarningMessage("Could not install git on windows. Install it manually.")
              }
              return ErrorMsg('Unsupported platform');
            }
            return ErrorMsg('Package manager could not be installed');
          });
        }
      );
    });
}

let mySshKeyDir: string | undefined = undefined;
function sshKeyDir(): string {
  if (mySshKeyDir) {
    return mySshKeyDir;
  }
  if (process.platform === 'darwin') {
    mySshKeyDir = execSync('echo ~/.ssh').toString().trim();
  } else if (process.platform === 'win32') {
    mySshKeyDir = execSync("echo %HOMEDRIVE%%HOMEPATH%\\.ssh").toString().trim();
  } else {
    throw new Error('Plattform not supported');
  }
  return mySshKeyDir;
}

function hasSshKeys(): Thenable<boolean> {
  if (process.platform === 'win32') {
    return inShell(`If (Test-Path -Path ${sshKeyDir()}\\id_rsa) { echo 1 }`, { disableChocoCheck: true })
      .then((result) => {
        if (result.success && result.msg === '1') {
          return true;
        }
        return false;
      });
  } else {
    return shellExec(`test -f ${sshKeyDir()}/id_rsa && echo 1`)
      .then((result) => {
        if (result.success && result.msg === '1') {
          return true;
        }
        return false;
      });
  }
}

function generateSshKeys(): Thenable<TaskMessage> {
  return hasSshKeys().then((hasKeys) => {
    if (hasKeys) {
      return new Promise((resolve) => resolve(SuccessMsg('Already had SSH Keys')));
    }
    return gitConfigGlobal('user.email')
      .then((email) => {
        if (process.platform === 'win32') {
          if (!fs.existsSync(sshKeyDir())) {
            fs.mkdirSync(sshKeyDir(), { recursive: true });
          }
          const cmd = `ssh-keygen -t rsa -C "${email}" -f ${sshKeyDir()}\\id_rsa -q -N '""'`;
          return inShell(cmd, { disableChocoCheck: true })
            .then((result) => {
              if (result.success) {
                return SuccessMsg(`SSH Key Pairs generated in ${sshKeyDir()}`)
              }
              return ErrorMsg(`Command failed: '${cmd}'.\n${result.error}`);
            });
        }
        const unixCmd = `cat /dev/zero | ssh-keygen -t rsa -C "${email}" -q -N ""`;
        return shellExec(unixCmd)
          .then((result) => {
            if (!result.success) {
              return ErrorMsg(`Command failed: '${unixCmd}'.\n${result.error}`);
            }
            return SuccessMsg(`SSH Key Pairs generated in ${sshKeyDir()}`);
          });
      });
  });
}

function gitConfigGlobal(property: string): Thenable<string> {
  return inOsShell(
    `git config --global ${property}`,
    { requiredCmd: 'git', disableChocoCheck: true }
  ).then((result) => {
    if (result.success) {
      return result.msg;
    }
    return '';
  });
}

function configure(force: boolean = false) {
  return isGitInstalled().then((isInstalled) => {
    if (!isInstalled) {
      return;
    }
    vscode.window.showInformationMessage(`Configure git settings`);
    let gitConfig = { name: '', email: '' };
    return Promise.all([
      gitConfigGlobal('user.name'),
      gitConfigGlobal('user.email')
    ]).then((configs) => {
      gitConfig.name = configs[0];
      gitConfig.email = configs[1];
    }).then((): Thenable<string | undefined> => {
      if (gitConfig.name.length === 0 || force) {
        return vscode.window.showInputBox({ prompt: "[Git] your name", value: gitConfig.name });
      }
      return new Promise((resolve) => resolve(undefined));
    }).then((gitName) => {
      if (gitName && gitName.trim().length > 0) {
        return gitConfigGlobal(`user.name "${gitName.trim()}"`);
      };
      return new Promise((resolve) => resolve(undefined));
    }).then((): Thenable<string | undefined> => {
      if (gitConfig.email.length === 0 || force) {
        return vscode.window.showInputBox({ prompt: "[Git] your email", value: gitConfig.email });
      }
      return new Promise((resolve) => resolve(undefined));
    }).then((gitEmail) => {
      if (gitEmail && gitEmail.trim().length > 0) {
        return gitConfigGlobal(`user.email "${gitEmail.trim()}"`);
      }
      return new Promise((resolve) => resolve(undefined));
    }).then(() => {
      return gitConfigGlobal('core.editor nano');
    }).then(() => {
      return generateSshKeys();
    }).then((result) => {
      if (result.msg !== 'Already had SSH Keys') {
        if (result.success) {
          vscode.window.showInformationMessage(result.msg!);
        } else {
          vscode.window.showErrorMessage(result.error!);
        }
      }
    }).then(() => {
      return Promise.all([
        gitConfigGlobal('user.name'),
        gitConfigGlobal('user.email')
      ]).then((configs) => {
        return { userName: configs[0], userEmail: configs[1] };
      });
    }).then(({ userName, userEmail }) => {
      vscode.window.showInformationMessage(`git configured:\nuser.name: '${userName}'\nuser.email: '${userEmail}'`);
    });
  });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  Logger.configure('Git2Go');
  Logger.log('Welcome to Git2Go');
  isGitInstalled().then((isInstalled) => {
    if (!isInstalled) {
      vscode.window.showWarningMessage(
        'Git is not installed', 'Install now'
      ).then((selection) => {
        if (selection === 'Install now') {
          return vscode.commands.executeCommand('git2go.install');
        }
      });
    }
  });

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let installDisposer = vscode.commands.registerCommand(
    "git2go.install",
    () => {
      Logger.show();
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "[Git2go]: Install",
          cancellable: true,
        },
        (progress, _token) => {
          progress.report({ message: "Start...", increment: 5 });
          return installGit(context, progress)
            .then((success) => {
              if (!success.success) {
                throw new Error("Installation failed.");
              }
              progress.report({ message: "Configure...", increment: 80 });
              return configure();
            })
            .then(() => {
              progress.report({ message: "Success", increment: 100 });
              vscode.window.showInformationMessage(
                "Git installed and configured."
              );
              vscode.commands.executeCommand('git2go.copySshKey');
            });
        }
      );
    }
  );

  let configureDisposer = vscode.commands.registerCommand(
    "git2go.configure",
    () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "[Git2go]: Configure"
        },
        (_progress, _token) => {
          return configure(true).then(() => {
            vscode.window.showInformationMessage(
              'Git Configured'
            );
          });
        }
      );
    }
  );

  let copySshKeyDisposer = vscode.commands.registerCommand(
    "git2go.copySshKey",
    () => {
      let pubKey: string | undefined = undefined;
      if (process.platform === 'win32') {
        pubKey = fs.readFileSync(`${sshKeyDir()}\\id_rsa.pub`).toString();
      } else {
        pubKey = fs.readFileSync(`${sshKeyDir()}/id_rsa.pub`).toString();
      }
      if (pubKey) {
        vscode.env.clipboard.writeText(pubKey);
        vscode.window.showInformationMessage(`Public Key on your Clipboard\n${pubKey}`);
      }
    }
  );

  let checkInstallationDisposer = vscode.commands.registerCommand(
    "git2go.checkInstallation",
    () => {
      isGitInstalled().then((isInstalled) => {
        if (isInstalled) {
          vscode.window.showInformationMessage('Git is installed on your system');
        } else {
          if (!isInstalled) {
            vscode.window.showWarningMessage(
              'Git is not installed', 'Install now'
            ).then((selection) => {
              if (selection === 'Install now') {
                return vscode.commands.executeCommand('git2go.install');
              }
            });
          }
        }
      });
    }
  );

  context.subscriptions.push(installDisposer);
  context.subscriptions.push(configureDisposer);
  context.subscriptions.push(copySshKeyDisposer);
  context.subscriptions.push(checkInstallationDisposer);
}

// this method is called when your extension is deactivated
export function deactivate() { }