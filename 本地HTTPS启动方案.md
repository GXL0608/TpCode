# 本地 HTTPS 启动方案（PC/移动端联调）

## 1. 目标

- 在不改业务代码的前提下，提供可落地的本地 HTTPS 启动方式。
- 让 PC 和手机都能通过 HTTPS 访问，满足录音/拍照等浏览器安全上下文要求。
- 兼容当前仓库已有启动方式（`packages/opencode` 后端 + `packages/app` 前端）。

## 2. 现状约束（基于当前代码）

- 前端开发模式下默认后端地址是 `http://...`：
  - `packages/app/src/utils/default-server-url.ts` 在 `dev` 分支固定拼 `http://${host}:${port}`。
- 后端当前仅以 HTTP 启动：
  - `packages/opencode/src/server/server.ts` 的 `Server.listen` 使用 `Bun.serve({ ...args, port })`，未暴露 TLS 证书参数。
- 结论：
  - 直接“前端 HTTPS + 后端 HTTP”会触发 Mixed Content，被浏览器拦截。
  - 本地 HTTPS 最稳妥做法是增加反向代理做 TLS 终止。

## 3. 推荐方案（单域名/单入口，优先采用）

架构：

- `packages/app` 先 `build` 出静态资源。
- `opencode web` 负责在 `http://0.0.0.0:4096` 提供页面和 API。
- `Caddy` 提供 `https://<LAN_IP>:3443`，反代到 `127.0.0.1:4096`。

优点：

- 页面和 API 同源，避免 CORS 和 Mixed Content。
- 手机端只需访问一个地址，联调最稳定。
- 不依赖前端 dev 模式下的 `http://` 默认后端逻辑。

## 4. 操作步骤（Windows）

### 4.1 安装工具

- 安装 `mkcert`（用于本地可信证书）。
- 安装 `caddy`（用于 HTTPS 反向代理）。

参考命令（任选你环境可用方式）：

```bat
winget install FiloSottile.mkcert
winget install CaddyServer.Caddy
```

### 4.2 生成证书

先查本机局域网 IP（例如 `192.168.1.102`）：

```bat
ipconfig
```

生成证书（把 IP 换成你的实际值）：

```bat
mkcert -install
mkcert -cert-file certs\tpcode-local.pem -key-file certs\tpcode-local-key.pem localhost 127.0.0.1 ::1 192.168.1.102
```

### 4.3 准备 Caddy 配置

在仓库根目录新建 `Caddyfile.local-https`：

```caddyfile
https://192.168.1.102:3443 {
  tls certs/tpcode-local.pem certs/tpcode-local-key.pem
  reverse_proxy 127.0.0.1:4096
}
```

### 4.4 启动后端（含 Web UI）

先构建前端静态资源（只需在前端代码变更后重跑）：

```bat
bun --cwd packages/app build
```

启动后端：

```bat
set TPCODE_LOCAL_STT_ENABLED=1 && ^
set TPCODE_LOCAL_STT_MODEL=small && ^
set TPCODE_LOCAL_STT_PREWARM=1 && ^
set TPCODE_LOCAL_STT_PREWARM_BLOCK=1 && ^
set HF_ENDPOINT=https://hf-mirror.com && ^
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 0.0.0.0 --port 4096
```

### 4.5 启动 HTTPS 反向代理

新开一个终端：

```bat
caddy run --config Caddyfile.local-https
```

### 4.6 访问地址

- PC：`https://192.168.1.102:3443`
- 手机：`https://192.168.1.102:3443`

要求：手机与电脑处于同一 Wi-Fi/局域网。

## 5. 手机证书信任

若手机出现“证书不受信任”，需要把 mkcert 根证书安装到手机并信任。

- 根证书位置（Windows）：`%LOCALAPPDATA%\mkcert\rootCA.pem`
- iOS：安装描述文件后，在“证书信任设置”里开启完全信任。
- Android：安装为用户 CA（浏览器可用；部分 App/容器可能不信任用户 CA）。

## 6. 验收清单

- 页面可打开且地址栏显示 HTTPS。
- 在浏览器控制台执行：

```js
location.protocol === "https:"
```

返回 `true`。

- 录音/拍照权限可弹出并可授权。
- 语音上传、图片上传、OCR、转写链路可走通。

## 7. 常见问题与处理

- 问题：`Mixed Content` 报错。
  - 原因：页面是 HTTPS，但请求了 `http://...` 接口。
  - 处理：使用本方案“后端统一承载 + HTTPS 反代单入口”。

- 问题：手机打不开地址。
  - 处理：确认同一局域网、关闭 AP 隔离、放行本机防火墙 `3443/4096` 端口。

- 问题：证书错误 `NET::ERR_CERT_AUTHORITY_INVALID`。
  - 处理：在手机安装并信任 mkcert 根证书。

- 问题：仍然有跨域问题。
  - 处理：检查是否误用了双入口；单入口模式下应同源无跨域。

## 8. 可选方案（需要前端 HMR 时）

如果必须保留前端热更新：

- `https://<LAN_IP>:3443` 反代到前端 dev（3000）。
- `https://<LAN_IP>:4443` 反代到后端（4096）。
- 后端增加 CORS 白名单：`--cors https://<LAN_IP>:3443`。
- 前端需手动把默认服务器地址设置为 `https://<LAN_IP>:4443`（否则 dev 默认会回退到 `http://...`）。

此模式可用，但运维复杂度明显高于推荐方案。
