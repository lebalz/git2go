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
import { Progress, SuccessfulMsg, ErroneousMsg, SuccessMsg } from "./helpers";

function installGitWindows(
  context: vscode.ExtensionContext,
  progress: Progress
): Thenable<SuccessMsg> {
  progress.report({ message: "Install Git", increment: 15 });
  return installChocolatey().then((version) => {
    if (!version) {
      vscode.window.showErrorMessage(
        "Could not install the package manager 'chocolatey'. Make sure to install it manually."
      );
      return ErroneousMsg('Could not install chocolatey.');
    }

    progress.report({
      message: `Chocolatey '${version}' Installed`,
      increment: 40,
    });

    if (!fs.existsSync(`${context.extensionPath}\\logs`)) {
      fs.mkdirSync(`${context.extensionPath}\\logs`);
    }

    const logPath = `${context.extensionPath}\\logs\\chocolog_${Date.now()}.log`;

    progress.report({
      message: `Install Git`,
      increment: 45,
    });
    return inElevatedShell(
      `
      choco install -y git.install | Tee-Object -FilePath ${logPath} | Write-Output
      \`$env:ChocolateyInstall = Convert-Path "$((Get-Command choco).Path)\\..\\.."
      Import-Module "$env:ChocolateyInstall\\helpers\\chocolateyProfile.psm1"
      refreshenv
      `
    )
      .then((out) => {
        progress.report({
          message: `Git installed:\n${out}`,
          increment: 80,
        });
        return SuccessfulMsg('Installed Git');
      })
      .catch((error) => {
        vscode.window.showErrorMessage(`Trouble installing git:\n${error}`);
        return ErroneousMsg(error);
      });
  }).catch((err) => {
    return ErroneousMsg(err);
  });
}

function installGitOsx(context: vscode.ExtensionContext, progress: Progress): Thenable<SuccessMsg> {
  return vscodeInstallBrew(context, progress, 30).then((success) => {
    if (!success) {
      return ErroneousMsg('Brew could not be installed');
    }
    const shellExec = promisify(exec);
    return shellExec('brew install git').then(({ stdout, stderr }) => {
      if (stderr.length > 0) {
        return ErroneousMsg(stderr);
      }
      return SuccessfulMsg(stdout);
    });
  });
}

function isGitInstalled(): Thenable<boolean> {
  if (process.platform === "darwin") {
    const shellExec = promisify(exec);
    return shellExec('git --version')
      .then(({ stdout, stderr }) => {
        if (stderr.length > 0) {
          return false;
        }
        if (stdout.length === 0) {
          return false;
        }
        return true;
      })
      .catch((err) => {
        console.log(err);
        return false;
      });
  } else if (process.platform === "win32") {
    return inShell(`choco list -lo`)
      .then((result) => {
        return /git /i.test(result);
      })
      .catch(() => false);
  }
  return new Promise((resolve) => resolve(false));
}

function installGit(context: vscode.ExtensionContext, progress: Progress): Thenable<SuccessMsg> {
  return isGitInstalled()
    .then((isInstalled) => {
      if (isInstalled) {
        return SuccessfulMsg('Already installed');
      }
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Install Git"
        },
        () => {
          if (process.platform === "darwin") {
            return installGitOsx(context, progress);
          } else if (process.platform === "win32") {
            return installGitWindows(context, progress);
          }
          return new Promise((resolve) => resolve(ErroneousMsg('Unsupported platform')));
        }
      );
    });
}

function sshKeyDir(): string {
  if (process.platform === 'darwin') {
    return execSync('echo ~/.ssh').toString().trim();
  } else if (process.platform === 'win32') {
    return execSync("echo %HOMEDRIVE%%HOMEPATH%\\.ssh").toString().trim();
  }

  throw new Error('Plattform not supported');
}

function hasSshKeys(): boolean {
  if (process.platform === 'win32') {
    return execSync(`IF EXIST ${sshKeyDir()}\\id_rsa ECHO 1`).toString().trim() === '1';
  } else {
    return execSync(`test -f ${sshKeyDir()}/id_rsa && echo 1`).toString().trim() === '1';
  }
}

function generateSshKeys() {
  if (hasSshKeys()) {
    return;
  }
  const email = gitConfigGlobal('user.email');
  if (process.platform === 'win32') {
    return execSync(`ssh-keygen -t rsa -C "${email}" -f %HOMEPATH%\.ssh\id_rsa -q -N ""`);
  }
  return execSync(`cat /dev/zero | ssh-keygen -t rsa -C "${email}" -q -N ""`);
}

function gitConfigGlobal(property: string): string {
  try {
    return execSync(`git config --global ${property}`).toString().trim();
  } catch (error) {
    return '';
  }
}

function configure(force: boolean = false) {
  vscode.window.showInformationMessage(`Configure git settings`);
  gitConfigGlobal('core.editor nano');
 
  let userName = gitConfigGlobal('user.name');
  let userEmail = gitConfigGlobal('user.email');

  return new Promise((resolve) => {
    if (userName.length === 0 || force) {
      return resolve(vscode.window.showInputBox({ prompt: "[Git] your name", value: userName })
        .then((gitName) => {
          if (gitName) {
            gitConfigGlobal(`user.name "${gitName.trim()}"`);
          }
        }));
    }
    return resolve();
  }).then(() => {
    return new Promise((resolve) => {
      if (userEmail.length === 0 || force) {
        return resolve(vscode.window.showInputBox({ prompt: "[Git] your email address", value: userEmail })
          .then((gitMail) => {
            if (gitMail) {
              gitConfigGlobal(`user.email "${gitMail.trim()}"`);
            }
          }));
      }
      return resolve();
    });
  }).then(() => {
    userName = gitConfigGlobal('user.name');
    userEmail = gitConfigGlobal('user.email');
    vscode.window.showInformationMessage(`git configured:\nuser.name '${userName}'\nuser.email '${userEmail}'`);
    return generateSshKeys();
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
            .then((location) => {
              if (!location) {
                throw new Error("Installation failed.");
              }
              progress.report({ message: "Configure...", increment: 95 });
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