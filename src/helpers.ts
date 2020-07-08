import * as vscode from "vscode";

export type Progress = vscode.Progress<{
  message?: string | undefined;
  increment?: number | undefined;
}>;


export interface SuccessMsg {
  success: boolean;
  msg?: string;
  error?: string;
}

export interface Successful extends SuccessMsg {
  success: true;
  msg: string;
}

export interface Erroneous extends SuccessMsg {
  success: false;
  error: string;
}

export function promptRootPassword(): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    password: true,
    prompt: "Root Password (used to login to your computer)",
  });
}

export function SuccessfulMsg(msg: string): Successful {
  return { success: true, msg: msg };
}

export function ErroneousMsg(error: string): Erroneous {
  return { success: false, error: error };
}
