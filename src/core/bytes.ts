/**
 * Byte utilities for UTF-8 encoding/decoding and buffer concatenation
 */

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

let encodeUTF8_: (str: string) => Uint8Array;
/** Encode string to UTF-8 Uint8Array (lazy TextEncoder creation) */
export function encodeUTF8(str: string): Uint8Array {
  return (
    encodeUTF8_ ??
    ((encoder) => (encodeUTF8_ = encoder.encode.bind(encoder)))(
      new TextEncoder(),
    )
  )(str);
}

let decodeUTF8_: (bytes: Uint8Array) => string;
/** Decode UTF-8 Uint8Array to string (lazy TextDecoder creation) */
export function decodeUTF8(bytes: Uint8Array): string {
  return (
    decodeUTF8_ ??
    ((decoder) => (decodeUTF8_ = decoder.decode.bind(decoder)))(
      new TextDecoder(),
    )
  )(bytes);
}
