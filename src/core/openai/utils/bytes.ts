/**
 * 字节工具函数
 *
 * 提供 Uint8Array 合并、UTF-8 编解码的惰性单例封装
 * 从 OpenAI SDK v6.38.0 移植
 */

/** 合并多个 Uint8Array */
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
/** 将字符串编码为 UTF-8 Uint8Array（惰性创建 TextEncoder） */
export function encodeUTF8(str: string): Uint8Array {
  return (
    encodeUTF8_ ??
    ((encoder) => (encodeUTF8_ = encoder.encode.bind(encoder)))(new TextEncoder())
  )(str);
}

let decodeUTF8_: (bytes: Uint8Array) => string;
/** 将 UTF-8 Uint8Array 解码为字符串（惰性创建 TextDecoder） */
export function decodeUTF8(bytes: Uint8Array): string {
  return (
    decodeUTF8_ ??
    ((decoder) => (decodeUTF8_ = decoder.decode.bind(decoder)))(new TextDecoder())
  )(bytes);
}
