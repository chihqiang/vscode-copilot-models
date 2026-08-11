/**
 * Byte utilities for UTF-8 encoding/decoding, buffer concatenation, and
 * image data handling
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Encode string to UTF-8 Uint8Array */
export function encodeUTF8(str: string): Uint8Array {
  return textEncoder.encode(str);
}

/** Decode UTF-8 Uint8Array to string */
export function decodeUTF8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** Merge multiple Uint8Arrays */
export function concatBytes(buffers: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}

/** Check whether a MIME type denotes an image */
export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * Encode bytes as a base64 data URL for the given MIME type.
 * Used for image attachments sent to OpenAI-compatible APIs.
 */
export function toDataUrl(data: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
}
