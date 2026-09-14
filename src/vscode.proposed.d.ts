/**
 * Hand-written declarations for the VS Code language-model API surface this
 * extension uses that the stable `vscode` typings do not carry yet.
 *
 * Only the members the extension actually reads or writes are declared — the
 * upstream proposals describe far more, and declaring fields nothing uses
 * would suggest they are supported.
 *
 * Two rules apply to everything here, verified against the extension host of
 * VS Code 1.137 (`out/vs/workbench/api/node/extensionHostProcess.js`):
 *
 * 1. Extra properties on the object a provider *returns* are passed through to
 *    the editor without any proposal check, so declaring them here is enough
 *    for `isBYOK` / `statusIcon`-style fields to take effect.
 * 2. A few are gated with `checkProposedApiEnabled(...)`, which **throws**
 *    rather than ignoring the value. `capabilities.editTools` is one of them:
 *    reporting it without listing `chatProvider` in
 *    `package.json#enabledApiProposals` makes model discovery fail outright.
 *    `package.json` therefore lists that proposal — see the comment there.
 */
declare module "vscode" {
  export class LanguageModelThinkingPart {
    constructor(value: string);
    readonly value: string;
  }

  export interface LanguageModelChatInformation {
    /**
     * Marks the model as BYOK — served with credentials the user supplied
     * rather than through the built-in Copilot service.
     *
     * Every model this extension exposes is BYOK by construction: an API key
     * from SecretStorage or a configured token plan pays for the request. VS
     * Code already infers that much for any model not coming from the Copilot
     * Chat extension, so declaring it does not change today's behaviour — it
     * states the fact instead of leaving the editor to derive it from which
     * extension happened to register the provider.
     */
    readonly isBYOK?: boolean;
  }

  export interface LanguageModelChatCapabilities {
    /**
     * The file-editing tools this model prefers, from the set the editor
     * recognises: `find-replace`, `multi-find-replace`, `apply-patch`,
     * `code-rewrite`.
     *
     * This is a hint, not a requirement. Leaving it unset makes the editor try
     * several edit tools and pick one, which is the safer default while a
     * model's editing strength is unknown — so the extension only reports it
     * when the user names the tools in `copilot-models.editTools`.
     */
    readonly editTools?: string[];
  }

  export interface ProvideLanguageModelChatResponseOptions {
    /**
     * What asked for the model: an extension id, or `"core"` for the editor's
     * own chat functionality.
     */
    readonly requestInitiator?: string;
  }
}
