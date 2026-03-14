import os
import subprocess

root = os.getcwd()

web_out = open(os.path.join(root, ".opencode-web.log"), "w")
web_err = open(os.path.join(root, ".opencode-web.err.log"), "w")
web_env = os.environ.copy()
web_env["TPCODE_LOCAL_STT_ENABLED"] = "1"
web_env["TPCODE_LOCAL_STT_MODEL"] = "small"
web_env["TPCODE_LOCAL_STT_PREWARM"] = "1"
web_env["TPCODE_LOCAL_STT_PREWARM_BLOCK"] = "1"
web_env["HF_ENDPOINT"] = "https://hf-mirror.com"
subprocess.Popen(
  [
    "bun",
    "run",
    "--cwd",
    "packages/opencode",
    "--conditions=browser",
    "src/index.ts",
    "web",
    "--hostname",
    "0.0.0.0",
    "--port",
    "4096",
  ],
  stdout=web_out,
  stderr=web_err,
  env=web_env,
  creationflags=0x00000008,
)

dev_out = open(os.path.join(root, ".opencode-dev.log"), "w")
dev_err = open(os.path.join(root, ".opencode-dev.err.log"), "w")
dev_env = os.environ.copy()
dev_env["VITE_OPENCODE_SERVER_HOST"] = "127.0.0.1"
dev_env["VITE_OPENCODE_SERVER_PORT"] = "4096"
subprocess.Popen(
  [
    "bun",
    "--cwd",
    "packages/app",
    "dev",
    "--host",
    "0.0.0.0",
    "--port",
    "3000",
  ],
  stdout=dev_out,
  stderr=dev_err,
  env=dev_env,
  creationflags=0x00000008,
)
