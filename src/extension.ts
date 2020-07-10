// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { promisify } from "util";
import { exec, execSync } from "child_process";

import * as fs from "fs";
import {
  installChocolatey,
  inElevatedShell,
  inShell,
} from "./package-manager/src/chocolatey";
import { vscodeInstallBrew } from "./package-manager/src/homebrew";
import { shellExec, inOsShell, vscodeInstallPackageManager } from "./package-manager/src/packageManager";
import { Progress, TaskMessage, ErrorMsg, SuccessMsg } from "./package-manager/src/helpers";

function installGitWindows(
  context: vscode.ExtensionContext
): Thenable<TaskMessage> {
  if (!fs.existsSync(context.logPath)) {
    fs.mkdirSync(context.logPath);
  }
  const logPath = `${context.logPath}\\chocolog_${Date.now()}.log`;

  return inElevatedShell(
    `choco install -y git.install | Tee-Object -FilePath ${logPath} | Write-Output`
  )
    .then((result) => {
      if (result.success) {
        return SuccessMsg('Installed Git');
      }
      vscode.window.showErrorMessage(`Trouble installing git:\n${result.error}`);
      return result;
    });
}

function installGitOsx(context: vscode.ExtensionContext): Thenable<TaskMessage> {
  if (!fs.existsSync(context.logPath)) {
    fs.mkdirSync(context.logPath);
  }
  const logPath = `${context.logPath}\\brewlog_${Date.now()}.log`;
  return shellExec(`brew install git &>> ${logPath}`);
}

function isGitInstalled(): Thenable<boolean> {
  return inOsShell('git --version', { disableChocoCheck: true, requiredCmd: 'git' })
    .then((result) => {
      if (result.success && result.msg.length > 0) {
        return true;
      }
      return false;
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
                return installGitWindows(context);
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
    return gitConfigGlobal('core.editor nano')
      .then(() => {
        return gitConfigGlobal('user.name');
      }).then((userName): Thenable<string | undefined> => {
        if (userName.length === 0 || force) {
          return vscode.window.showInputBox({ prompt: "[Git] your name", value: userName });
        }
        return new Promise((resolve) => resolve(undefined));
      }).then((gitName) => {
        if (gitName && gitName.trim().length > 0) {
          return gitConfigGlobal(`user.name "${gitName.trim()}"`);
        };
      }).then(() => {
        return gitConfigGlobal('user.email');
      }).then((userEmail): Thenable<string | undefined> => {
        if (userEmail.length === 0 || force) {
          return vscode.window.showInputBox({ prompt: "[Git] your email", value: userEmail });
        }
        return new Promise((resolve) => resolve(undefined));
      }).then((gitEmail) => {
        if (gitEmail && gitEmail.trim().length > 0) {
          return gitConfigGlobal(`user.email "${gitEmail.trim()}"`);
        }
      }).then(() => {
        return Promise.all([
          gitConfigGlobal('user.name'),
          gitConfigGlobal('user.email')
        ]).then((configs) => {
          return { userName: configs[0], userEmail: configs[1] };
        });
      }).then(({ userName, userEmail }) => {
        vscode.window.showInformationMessage(`git configured:\nuser.name '${userName}'\nuser.email '${userEmail}'`);
        return generateSshKeys();
      }).then((result) => {
        if (result.msg !== 'Already had SSH Keys') {
          if (result.success) {
            vscode.window.showInformationMessage(result.msg!);
          } else {
            vscode.window.showErrorMessage(result.error!);
          }
        }
      });
  });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "git2go" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let installDisposer = vscode.commands.registerCommand(
    "git2go.install",
    () => {
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
            });
        }
      );
    }
  );

  let configureDisposer = vscode.commands.registerCommand(
    "git2go.configure",
    () => {
      configure(true).then(() => {
        vscode.window.showInformationMessage(
          'Configured Git'
        );
      });
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

  context.subscriptions.push(installDisposer);
  context.subscriptions.push(configureDisposer);
  context.subscriptions.push(copySshKeyDisposer);
}

// this method is called when your extension is deactivated
export function deactivate() { }