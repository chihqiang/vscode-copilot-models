/**
 * Regression tests for using another extension's model as the vision proxy.
 *
 * VS Code gates one extension using another's models behind an approval the
 * user gives, and the `justification` passed to `sendRequest` is the only
 * explanation that prompt carries. The describer used to send no options at
 * all. The bundled Copilot extension is one of the providers that asks for
 * that approval — it reports `requiresAuthorization` on its models — so this is
 * the common path, not an edge case.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  VISION_MODEL_JUSTIFICATION,
  visionModelAccessError,
  visionModelRefusal,
} from "../core/vision";

/** Only the members the helpers read. */
function fakeModel(id: string, vendor: string): vscode.LanguageModelChat {
  return {
    id,
    vendor,
    name: id,
    family: id,
    version: "1",
  } as unknown as vscode.LanguageModelChat;
}

function fakeAccess(
  decision: boolean | undefined,
): vscode.LanguageModelAccessInformation {
  return {
    canSendRequest: () => decision,
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as vscode.LanguageModelAccessInformation;
}

suite("vision model access Test Suite", () => {
  test("the justification names what the access is for", () => {
    // The prompt renders this as "Justification: <text>"; an empty string
    // would leave the user approving access with no stated reason.
    assert.ok(VISION_MODEL_JUSTIFICATION.length > 20);
    assert.ok(
      VISION_MODEL_JUSTIFICATION.includes("image"),
      "it must say what the model is being used for",
    );
  });

  test("a refused model produces an actionable message", () => {
    const refusal = visionModelRefusal(
      fakeAccess(false),
      fakeModel("gpt-5", "copilot"),
    );

    assert.ok(refusal, "a persisted refusal must be reported before sending");
    assert.ok(refusal.includes("gpt-5"), refusal);
    assert.ok(refusal.includes("copilot"), refusal);
    // Actionable: names a command the user can actually run.
    assert.ok(
      refusal.includes(
        "workbench.action.chat.manageLanguageModelAuthentication",
      ),
      refusal,
    );
  });

  test("an unanswered approval is not treated as a refusal", () => {
    // `canSendRequest` returns undefined when consent was never asked for.
    // Treating that as a refusal would block the request that triggers the
    // prompt, so the proxy could never ask.
    assert.strictEqual(
      visionModelRefusal(fakeAccess(undefined), fakeModel("gpt-5", "copilot")),
      undefined,
    );
  });

  test("an approved model is usable", () => {
    assert.strictEqual(
      visionModelRefusal(fakeAccess(true), fakeModel("gpt-5", "copilot")),
      undefined,
    );
  });

  test("missing access information is not a refusal", () => {
    // Defensive: the describer is constructed without it in some tests.
    assert.strictEqual(
      visionModelRefusal(undefined, fakeModel("gpt-5", "copilot")),
      undefined,
    );
  });

  test("a refusal error becomes an actionable message", () => {
    // This is what the provider throws when access was refused; without the
    // translation the user sees only "Vision proxy failed: ...".
    const error = vscode.LanguageModelError.NoPermissions(
      "Language model 'gpt-5' cannot be used by 'chihqiang.vscode-copilot-models'.",
    );

    const message = visionModelAccessError(error);

    assert.ok(message, "a NoPermissions error must be translated");
    assert.ok(message.includes("workbench.action.chat"), message);
  });

  test("a blocked error becomes an actionable message", () => {
    const message = visionModelAccessError(
      vscode.LanguageModelError.Blocked("blocked"),
    );

    assert.ok(message);
    assert.ok(message.includes("workbench.action.chat"), message);
  });

  test("unrelated failures are left alone", () => {
    // A transport failure must keep its own message — rewriting it would
    // replace a useful error with misleading advice.
    assert.strictEqual(
      visionModelAccessError(new Error("ECONNREFUSED")),
      undefined,
    );
    assert.strictEqual(visionModelAccessError("not an error"), undefined);
    assert.strictEqual(
      visionModelAccessError(vscode.LanguageModelError.NotFound("gone")),
      undefined,
    );
  });
});
