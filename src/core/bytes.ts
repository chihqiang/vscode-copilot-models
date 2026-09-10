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
 * Largest buffer, in bytes, whose data URL is memoised.
 *
 * A cached data URL is retained for as long as the image buffer itself (the
 * cache is keyed weakly by buffer identity), and base64 inflates an image by
 * about a third. Capping the size keeps that overhead bounded while still
 * covering the common case — a screenshot or pasted diagram — where the same
 * buffer is re-encoded on every turn of the conversation.
 */
export const DATA_URL_CACHE_MAX_BYTES = 512 * 1024;

/**
 * Memoised data URLs, keyed by buffer identity then MIME type.
 *
 * Exported (prefixed with `_`) so tests can assert what is cached.
 */
export const _dataUrlCache = new WeakMap<Uint8Array, Map<string, string>>();

/**
 * Encode bytes as a base64 data URL for the given MIME type.
 * Used for image attachments sent to OpenAI-compatible APIs.
 *
 * Keyed on the buffer instance: identical bytes in a different buffer are
 * encoded again rather than compared byte-by-byte, so a hit is only possible
 * when the caller passes the very same buffer. That happens for the image
 * parts of historical messages, which VS Code re-sends on every turn.
 */
export function toDataUrl(data: Uint8Array, mimeType: string): string {
  const byMime = _dataUrlCache.get(data);
  const cached = byMime?.get(mimeType);
  if (cached !== undefined) {
    return cached;
  }

  const url = `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;

  if (data.length <= DATA_URL_CACHE_MAX_BYTES) {
    if (byMime) {
      byMime.set(mimeType, url);
    } else {
      _dataUrlCache.set(data, new Map([[mimeType, url]]));
    }
  }

  return url;
}
