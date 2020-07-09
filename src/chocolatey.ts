import * as Shell from 'node-powershell';
import { execSync } from 'child_process';

export function powershell() {
  return new Shell({
    executionPolicy: 'Bypass',
    verbose: true,
    noProfile: true
  });
}

export function chocolateyVersion(): Promise<string | undefined> {
  const ps = powershell();
  ps.addCommand("choco -v");
  return ps.invoke().then((out) => {
    return out;
  }).catch((error) => {
    return undefined;
  });
}

export function isChocolateyInstalled(): Promise<boolean> {
  return chocolateyVersion().then((version) => {
    if (version) {
      return true;
    }
    return false;
  });
}

export function inElevatedShell(command: string): Promise<string> {
  const ps = powershell();
  const cmd = `Start-Process -FilePath "powershell" -Wait -Verb RunAs -ArgumentList "-noprofile", "-command &{${command.replace(/(\r\n|\n|\r)/gm, "").replace(/"/g, '`"')}}"`;
  ps.addCommand(cmd);
  return ps.invoke();
}

export function inShell(command: string): Promise<string> {
  const ps = powershell();
  ps.addCommand(command);
  return ps.invoke();
}

export function installChocolatey(logPath?: string): Promise<string | undefined> {
  return chocolateyVersion().then((version) => {
    if (version) {
      return version;
    }
    const logTo = logPath ? `Tee-Object -FilePath ${logPath} | Write-Output` : 'Write-Output';

    return inElevatedShell(
      `if (-Not (Test-Path -Path "$env:ProgramData\\Chocolatey")) {
          if ("RemoteSigned", "AllSigned" -notcontains $(Get-ExecutionPolicy)) {
            Set-ExecutionPolicy -f -ExecutionPolicy RemoteSigned
          }
          Invoke-Expression((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1')) | ${logTo}
        } else {
          echo "Chocolatey already installed"
        }`
    ).then((output) => {
      return chocolateyVersion();
    }).catch((error) => {
      return undefined;
    });
  });
}

export function logSummaryPath() {
  const programData = execSync('echo %ProgramData%').toString().trim();
  return `${programData}\\chocolatey\\logs\\choco.summary.log`;
}

export function logSummary(): Promise<string> {
  const ps = powershell();
  ps.addCommand(`Get-Content -Path ${logSummaryPath()}`);
  return ps.invoke();
}

export function logSummaryLineCount(): Promise<number> {
  const ps = powershell();
  ps.addCommand(`(gc ${logSummaryPath()}).count`);
  return ps.invoke().then((lineCount) => {
    return Number.parseInt(lineCount, 10);
  }).catch(() => {
    return 0;
  });
}

export function uninstall(pkg: string, version?: string) {
  if (version) {
    return inElevatedShell(`cuninst -y ${pkg} --version ${version}`);
  }
  return inElevatedShell(`cuninst -y ${pkg}`);
}

export function setExecutionPolicy() {
  return getExecutionPolicy().then((policy) => {
    if (policy === 'RemoteSigned' || policy === 'AllSigned') {
      return policy;
    }
    return inElevatedShell('Set-ExecutionPolicy -f -ExecutionPolicy RemoteSigned').then(() => 'RemoteSigned');
  });
}

export function getExecutionPolicy() {
  const ps = powershell();
  ps.addCommand('Get-ExecutionPolicy');
  return ps.invoke().then((result) => {
    return result.trim();
  });
}