interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  exec?(query: string): Promise<D1Result>;
}

interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
}

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob,
    options?: R2PutOptions,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  get(key: string, options: { onlyIf: { etagMatches: string } }): Promise<R2ObjectBody | R2Object | null>;
  head(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare class FixedLengthStream {
  constructor(expectedLength: number | bigint);
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    FILES: R2Bucket;
  };
}

declare module "next/server" {
  export class NextResponse extends Response {
    static json<JsonBody>(
      body: JsonBody,
      init?: ResponseInit,
    ): NextResponse;
  }
}

declare module "next/headers" {
  export function headers(): Promise<Headers> & Headers;
}

declare module "next/navigation" {
  export function redirect(url: string): never;
}
