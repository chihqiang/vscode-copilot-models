/**
 * Message conversion utilities for OpenAI-compatible API format
 */

import type { ContentPart, ApiMessage, ApiTool } from "./client";

function toTextContent(
  content: string | ContentPart[],
): string | { type: "text"; text: string }[] {
  if (typeof content === "string") {
    return content;
  }
  return content.filter(
    (p): p is { type: "text"; text: string } => p.type === "text",
  );
}

export function toChatCompletionMessageParam(
  message: ApiMessage,
): Record<string, unknown> {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: toTextContent(message.content),
      };
    case "user":
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content,
      };
    case "assistant": {
      const msg: Record<string, unknown> = {
        role: "assistant",
        content: toTextContent(message.content),
      };
      if (message.reasoning_content) {
        msg.reasoning_content = message.reasoning_content;
      }
      if (message.tool_calls && message.tool_calls.length > 0) {
        msg.tool_calls = message.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          type: toolCall.type,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        }));
      }
      return msg;
    }
    case "tool":
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.tool_call_id ?? "",
      };
    default:
      throw new Error("Unsupported message role");
  }
}

/** @returns tool definition directly (shape matches OpenAI API, undefined stripped by JSON.stringify) */
export function toChatCompletionTool(tool: ApiTool): Record<string, unknown> {
  return tool as unknown as Record<string, unknown>;
}
