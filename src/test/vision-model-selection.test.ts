/**
 * Regression tests for the vision proxy's model selection.
 *
 * The describer used to accept any model, including ones that cannot accept
 * image input. Because the list also contains the models this extension
 * serves, choosing one of those made the description request come straight
 * back to this extension — which proxied it again, forever. The selection is
 * therefore filtered on image support, and what "support" means has to survive
 * an editor that does not report `capabilities` at all.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  canAcceptImages,
  containsImageParts,
  isDescribingWith,
  selectVisionCapable,
  visionModelNeedsImageInputMessage,
} from "../core/vision";

/** Only the members the helpers read. */
function fakeModel(
  id: string,
  capabilities?: { supportsImageToText?: boolean },
): vscode.LanguageModelChat {
  const model: Record<string, unknown> = {
    id,
    vendor: "test",
    name: id,
    family: id,
    version: "1",
  };
  if (capabilities !== undefined) {
    model.capabilities = capabilities;
  }
  return model as unknown as vscode.LanguageModelChat;
}

const ids = (models: readonly vscode.LanguageModelChat[]) =>
  models.map((m) => m.id);

suite("vision model capability filter Test Suite", () => {
  test("a declared support flag is reported as-is", () => {
    assert.strictEqual(
      canAcceptImages(fakeModel("a", { supportsImageToText: true })),
      true,
    );
    assert.strictEqual(
      canAcceptImages(fakeModel("a", { supportsImageToText: false })),
      false,
    );
  });

  test("a missing flag is unknown, not a refusal", () => {
    // The distinction matters: treating it as `false` would refuse every model
    // on an editor that does not carry the field.
    assert.strictEqual(canAcceptImages(fakeModel("a")), undefined);
    assert.strictEqual(
      canAcceptImages(fakeModel("a", {})),
      undefined,
      "capabilities without the flag says nothing",
    );
  });

  test("models that cannot see are dropped", () => {
    const models = [
      fakeModel("blind", { supportsImageToText: false }),
      fakeModel("sees", { supportsImageToText: true }),
    ];

    assert.deepStrictEqual(ids(selectVisionCapable(models)), ["sees"]);
  });

  test("every model is kept when none declares anything", () => {
    // An editor without `capabilities` reports nothing for anyone. Filtering
    // there would empty the picker and disable the feature entirely.
    const models = [fakeModel("a"), fakeModel("b")];

    assert.deepStrictEqual(ids(selectVisionCapable(models)), ["a", "b"]);
  });

  test("an unknown model is dropped once any other declares support", () => {
    // A partial answer still means the editor knows about `capabilities`, so a
    // model that does not claim image support cannot be assumed to have it.
    const models = [
      fakeModel("silent"),
      fakeModel("sees", { supportsImageToText: true }),
    ];

    assert.deepStrictEqual(ids(selectVisionCapable(models)), ["sees"]);
  });

  test("a model that declares no support leaves nothing to pick", () => {
    // Every model answered "no" — there is genuinely no vision model, so the
    // caller must be able to tell that from an empty list.
    const models = [fakeModel("a", { supportsImageToText: false })];

    assert.deepStrictEqual(ids(selectVisionCapable(models)), []);
  });

  test("the filtered list is a copy, not a view", () => {
    // selectVisionCapable() is given the array selectChatModels() returned;
    // mutating it in place would corrupt a cached result.
    const models = [fakeModel("a"), fakeModel("b")];
    const result = selectVisionCapable(models);

    result.pop();

    assert.strictEqual(models.length, 2);
  });

  test("the refusal names the model and the command that fixes it", () => {
    const message = visionModelNeedsImageInputMessage("glm-5.3");

    assert.ok(message.includes("glm-5.3"), message);
    assert.ok(
      message.includes("Copilot Models: Set Vision Model"),
      "the message has to say how to recover",
    );
  });
});

suite("image part detection Test Suite", () => {
  test("finds an image in any message", () => {
    const messages = [
      vscode.LanguageModelChatMessage.User("no image here"),
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart("look"),
        new vscode.LanguageModelDataPart(new Uint8Array([1, 2]), "image/png"),
      ]),
    ];

    assert.strictEqual(containsImageParts(messages), true);
  });

  test("ignores data parts that are not images", () => {
    // JSON travels in the same part type; counting it would make an AI commit
    // message on a text-only model look like a nested description.
    const messages = [
      vscode.LanguageModelChatMessage.User([
        vscode.LanguageModelDataPart.json({ answer: 42 }),
      ]),
    ];

    assert.strictEqual(containsImageParts(messages), false);
  });

  test("reports false for a text-only conversation", () => {
    assert.strictEqual(
      containsImageParts([
        vscode.LanguageModelChatMessage.User("hello"),
        vscode.LanguageModelChatMessage.Assistant("hi"),
      ]),
      false,
    );
  });

  test("an empty conversation has no images", () => {
    assert.strictEqual(containsImageParts([]), false);
  });
});

suite("image description re-entrancy guard Test Suite", () => {
  test("nothing is in flight before a description starts", () => {
    assert.strictEqual(isDescribingWith("glm-5.3"), false);
  });

  test("the guard is keyed by model id", () => {
    // Only the model being described with can come back as a nested request,
    // so an unrelated model must stay unaffected.
    assert.strictEqual(isDescribingWith("deepseek-flash"), false);
  });
});
