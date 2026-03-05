import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { parse as parseJsonc, type ParseError as JsoncParseError } from "jsonc-parser"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const accountEnabledCache = {
  cwd: "",
  configPath: undefined as string | undefined,
  mtimeMs: undefined as number | undefined,
  value: true,
}

function findTPCODEConfigPath(start: string) {
  let dir = start
  while (true) {
    const jsonc = path.join(dir, ".opencode", "opencode.jsonc")
    if (existsSync(jsonc)) return jsonc
    const json = path.join(dir, ".opencode", "opencode.json")
    if (existsSync(json)) return json
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return
}

function parseTPCODEAccountEnabled(filepath: string) {
  try {
    const text = readFileSync(filepath, "utf-8")
    const errors: JsoncParseError[] = []
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) return
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    const value = (parsed as Record<string, unknown>).TPCODE_ACCOUNT_ENABLED
    if (typeof value === "boolean") return value
  } catch {
    return
  }
  return
}

function readTPCODEAccountEnabledFromConfig() {
  const cwd = process.cwd()
  if (accountEnabledCache.cwd !== cwd) {
    accountEnabledCache.cwd = cwd
    accountEnabledCache.configPath = findTPCODEConfigPath(cwd)
    accountEnabledCache.mtimeMs = undefined
  }

  if (!accountEnabledCache.configPath) {
    accountEnabledCache.value = true
    return accountEnabledCache.value
  }

  let mtimeMs: number
  try {
    mtimeMs = statSync(accountEnabledCache.configPath).mtimeMs
  } catch {
    accountEnabledCache.configPath = findTPCODEConfigPath(cwd)
    accountEnabledCache.mtimeMs = undefined
    if (!accountEnabledCache.configPath) {
      accountEnabledCache.value = true
      return accountEnabledCache.value
    }
    try {
      mtimeMs = statSync(accountEnabledCache.configPath).mtimeMs
    } catch {
      accountEnabledCache.value = true
      return accountEnabledCache.value
    }
  }

  if (accountEnabledCache.mtimeMs === mtimeMs) return accountEnabledCache.value

  accountEnabledCache.mtimeMs = mtimeMs
  accountEnabledCache.value = parseTPCODEAccountEnabled(accountEnabledCache.configPath) ?? true
  return accountEnabledCache.value
}

export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]
  export declare const OPENCODE_TUI_CONFIG: string | undefined
  export declare const OPENCODE_CONFIG_DIR: string | undefined
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENCODE_DISABLE_EXTERNAL_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENCODE_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]
  export declare const OPENCODE_CLIENT: string
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]
  export declare const TPCODE_ACCOUNT_ENABLED: boolean
  export declare const TPCODE_ACCOUNT_JWT_SECRET: string | undefined
  export declare const TPCODE_ACCOUNT_INVITE_CODE: string | undefined
  export declare const TPCODE_ADMIN_PASSWORD: string | undefined
  export declare const TPCODE_REGISTER_MODE: string | undefined
  export declare const TPCODE_FORBIDDEN_WORDS: string | undefined
  export declare const TPCODE_PROVIDER_STRICT_ACCOUNT: boolean
  export declare const TPCODE_ACCOUNT_AUTH_DEBUG: boolean
  export declare const TPCODE_PROJECT_SCAN_ROOT: string | undefined
  export declare const TPCODE_LIGHT_INSTANCE_ROUTES: boolean
  export declare const TPCODE_CONTEXT_CACHE: boolean
  export declare const TPCODE_EVENT_VISIBILITY_CACHE: boolean
  export declare const TPCODE_SESSION_SEARCH_INFO_LOG: boolean
  export declare const OPENCODE_WEB_ALLOW_REMOTE_PROXY: boolean
  export const OPENCODE_ENABLE_QUESTION_TOOL = truthy("OPENCODE_ENABLE_QUESTION_TOOL")

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")
  export const OPENCODE_DISABLE_FILETIME_CHECK = truthy("OPENCODE_DISABLE_FILETIME_CHECK")
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")
  export const OPENCODE_EXPERIMENTAL_MARKDOWN = truthy("OPENCODE_EXPERIMENTAL_MARKDOWN")
  export const OPENCODE_MODELS_URL = process.env["OPENCODE_MODELS_URL"]
  export const OPENCODE_MODELS_PATH = process.env["OPENCODE_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for OPENCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_TUI_CONFIG", {
  get() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENCODE_CLIENT", {
  get() {
    return process.env["OPENCODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_ACCOUNT_ENABLED", {
  get() {
    return readTPCODEAccountEnabledFromConfig()
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_ACCOUNT_JWT_SECRET", {
  get() {
    return process.env["TPCODE_ACCOUNT_JWT_SECRET"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_ACCOUNT_INVITE_CODE", {
  get() {
    return process.env["TPCODE_ACCOUNT_INVITE_CODE"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_ADMIN_PASSWORD", {
  get() {
    return process.env["TPCODE_ADMIN_PASSWORD"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_REGISTER_MODE", {
  get() {
    return process.env["TPCODE_REGISTER_MODE"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_FORBIDDEN_WORDS", {
  get() {
    return process.env["TPCODE_FORBIDDEN_WORDS"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_PROVIDER_STRICT_ACCOUNT", {
  get() {
    const value = process.env["TPCODE_PROVIDER_STRICT_ACCOUNT"]?.toLowerCase()
    if (value === undefined) return true
    return value === "true" || value === "1"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_ACCOUNT_AUTH_DEBUG", {
  get() {
    return truthy("TPCODE_ACCOUNT_AUTH_DEBUG")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_PROJECT_SCAN_ROOT", {
  get() {
    return process.env["TPCODE_PROJECT_SCAN_ROOT"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_LIGHT_INSTANCE_ROUTES", {
  get() {
    const value = process.env["TPCODE_LIGHT_INSTANCE_ROUTES"]?.toLowerCase()
    if (value === undefined) return true
    return value === "true" || value === "1"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_CONTEXT_CACHE", {
  get() {
    const value = process.env["TPCODE_CONTEXT_CACHE"]?.toLowerCase()
    if (value === undefined) return true
    return value === "true" || value === "1"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_EVENT_VISIBILITY_CACHE", {
  get() {
    const value = process.env["TPCODE_EVENT_VISIBILITY_CACHE"]?.toLowerCase()
    if (value === undefined) return true
    return value === "true" || value === "1"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "TPCODE_SESSION_SEARCH_INFO_LOG", {
  get() {
    return truthy("TPCODE_SESSION_SEARCH_INFO_LOG")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_WEB_ALLOW_REMOTE_PROXY", {
  get() {
    const value = process.env["OPENCODE_WEB_ALLOW_REMOTE_PROXY"]?.toLowerCase()
    if (value === undefined) return false
    return value === "true" || value === "1"
  },
  enumerable: true,
  configurable: false,
})
