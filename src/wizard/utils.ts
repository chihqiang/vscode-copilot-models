/**
 * Shared UI helpers for configuration wizards
 *
 * Extracts the repetitive "pick a single item (auto-select when only one)"
 * and "confirm a destructive action" patterns shared by the API key, token
 * plan and vision model wizards.
 */

import vscode from "vscode";

/**
 * Pick a single item from a list. Returns the item directly when there is
 * only one candidate, otherwise shows a QuickPick. Returns undefined when
 * the user cancels.
 */
export async function pickSingle<T extends object>(
  items: readonly T[],
  toItem: (item: T) => vscode.QuickPickItem & { item: T },
  options: {
    title: string;
    placeHolder: string;
  },
): Promise<T | undefined> {
  if (items.length === 0) {
    return undefined;
  }
  if (items.length === 1) {
    return items[0];
  }
  const picked = await vscode.window.showQuickPick(items.map(toItem), {
    title: options.title,
    placeHolder: options.placeHolder,
    ignoreFocusOut: true,
  });
  return picked?.item;
}

/**
 * Show a modal confirmation dialog with a "proceed" button and a cancel
 * button. Returns true only when the user chose to proceed.
 */
export async function confirmAction(
  message: string,
  proceedLabel: string,
  cancelLabel = "Cancel",
): Promise<boolean> {
  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    proceedLabel,
    cancelLabel,
  );
  return result === proceedLabel;
}
