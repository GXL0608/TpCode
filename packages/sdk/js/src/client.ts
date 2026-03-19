export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

/** 中文注释：把目录编码成稳定的 ASCII header，避免中文/共享路径在浏览器与 Bun 间传输时出现乱码或卡死。 */
function encodeDirectoryHeader(directory: string) {
  const bytes = new TextEncoder().encode(directory)
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64url")
      : btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "")
  return `b64:${encoded}`
}

export function createOpencodeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeDirectoryHeader(config.directory),
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
