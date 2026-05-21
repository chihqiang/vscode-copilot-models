/**
 * SSE 流解析器
 *
 * 从 OpenAI SDK v6.38.0 移植，仅保留运行所需的最小代码：
 * - Stream 类：AsyncIterable 包装，支持 SSE 解析
 * - SSEDecoder：逐行解析 SSE 协议
 * - _iterSSEMessages：从 Response body 迭代 SSE 消息
 * - iterSSEChunks：处理分块传输编码，按双换行分割
 * - readableStreamToAsyncIterable：桥接 Web Stream 与 AsyncIterator
 */

import { encodeUTF8 } from './utils/bytes';
import { findDoubleNewlineIndex, LineDecoder } from './decoders/line';
import { logger } from '../logger';

/** SSE 消息结构 */
export interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

/**
 * 异步可迭代流
 * 包装 SSE 响应，提供 for await...of 遍历接口
 */
export class Stream<Item> implements AsyncIterable<Item> {
  controller: AbortController;

  constructor(
    private iterator: () => AsyncIterator<Item>,
    controller: AbortController,
  ) {
    this.controller = controller;
  }

  /**
   * 从 HTTP Response 创建流
   * 解析 SSE 数据，跳过 [DONE] 标记和 thread.* 事件，
   * 对数据行进行 JSON 解析并逐个 yield
   */
  static fromSSEResponse<Item>(response: Response, controller: AbortController): Stream<Item> {
    let consumed = false;

    async function* iterator(): AsyncIterator<Item> {
      if (consumed) {
        throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (done) {continue;}

          if (sse.data.startsWith('[DONE]')) {
            done = true;
            continue;
          }

          if (sse.event === null || !sse.event.startsWith('thread.')) {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }

            if (data && data.error) {
              throw new Error(data.error.message || JSON.stringify(data.error));
            }

            yield data as Item;
          } else {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }
            if (sse.event === 'error') {
              throw new Error(data.error?.message || data.message || 'Unknown SSE error');
            }
            yield { event: sse.event, data } as any;
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) {return;}
        throw e;
      } finally {
        if (!done) {controller.abort();}
      }
    }

    return new Stream(iterator, controller);
  }

  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return this.iterator();
  }
}

/**
 * 从 Response body 迭代 SSE 消息
 * 组合 LineDecoder（按行分割）和 SSEDecoder（按空行分割）
 */
export async function* _iterSSEMessages(
  response: Response,
  controller: AbortController,
): AsyncGenerator<ServerSentEvent> {
  if (!response.body) {
    controller.abort();
    throw new Error('Attempted to iterate over a response with no body');
  }

  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = readableStreamToAsyncIterable<Uint8Array>(response.body);

  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) {yield sse;}
    }
  }

  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) {yield sse;}
  }
}

/**
 * 分块传输处理
 * 累积二进制块，按双换行(\n\n / \r\n\r\n)分割为独立的 SSE chunk
 */
async function* iterSSEChunks(iterator: AsyncIterableIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  let data = new Uint8Array();

  for await (const chunk of iterator) {
    if (chunk === null || chunk === undefined) {continue;}

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;

    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.subarray(patternIndex);
    }
  }

  if (data.length > 0) {
    yield data;
  }
}

/**
 * SSE 协议解码器
 * 按 SSE 规范解析字段：
 * - event: 事件类型
 * - data: 数据行（多行用 \n 拼接）
 * - 空行触发完成事件
 * - 以 : 开头的行是注释，忽略
 */
class SSEDecoder {
  private data: string[];
  private event: string | null;
  private chunks: string[];

  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }

    if (!line) {
      if (!this.event && !this.data.length) {return null;}

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks,
      };

      this.event = null;
      this.data = [];
      this.chunks = [];

      return sse;
    }

    this.chunks.push(line);

    if (line.startsWith(':')) {return null;}

    let [fieldname, _, value] = partition(line, ':');

    if (value.startsWith(' ')) {
      value = value.substring(1);
    }

    if (fieldname === 'event') {
      this.event = value;
    } else if (fieldname === 'data') {
      this.data.push(value);
    }

    return null;
  }
}

/** 按分隔符拆分字符串 */
function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, '', ''];
}

/**
 * 将 Web ReadableStream 转为 AsyncIterableIterator
 * 桥接 Web Streams API 与 for await...of 语法
 */
function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterableIterator<T> {
  if ((stream as any)[Symbol.asyncIterator]) {return stream as any;}

  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) {reader.releaseLock();}
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: undefined as any };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/** 判断是否为中止错误 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (('name' in err && (err as any).name === 'AbortError') ||
      ('message' in err && String((err as any).message).includes('FetchRequestCanceledException')))
  );
}
