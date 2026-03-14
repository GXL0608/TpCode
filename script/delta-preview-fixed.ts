import { createServer } from "node:http"
import { createDelta, fileDelta, readDelta } from "../packages/console/app/src/lib/delta-job.ts"

const port = Number(process.env.TPCODE_DELTA_PORT || process.env.PORT || 4097)

const page = [
  "<!doctype html>",
  "<html lang=\"zh-CN\">",
  "<head>",
  "  <meta charset=\"utf-8\" />",
  "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
  "  <title>Git 增量部署包测试页</title>",
  "  <style>",
  "    :root { --bg:#f5f1ea; --panel:#fffdf9; --line:#ddd2c3; --text:#2b241d; --muted:#6d6257; --accent:#d25e34; --soft:#fff2ea; --danger:#8f2d1b; }",
  "    * { box-sizing:border-box; }",
  "    body { margin:0; font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--text); background:var(--bg); }",
  "    main { max-width:1080px; margin:0 auto; padding:32px 20px 64px; }",
  "    h1,h2,h3,p { margin:0; }",
  "    h1 { font-size:34px; line-height:1.1; }",
  "    .panel { margin-top:16px; padding:20px; border:1px solid var(--line); background:var(--panel); }",
  "    .muted { color:var(--muted); }",
  "    .eyebrow { margin-bottom:10px; color:var(--accent); text-transform:uppercase; letter-spacing:.12em; }",
  "    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:16px; }",
  "    label { display:block; }",
  "    label span { display:block; margin-bottom:6px; }",
  "    input,select,textarea,button { width:100%; padding:11px 12px; border:1px solid var(--line); background:#fff; color:var(--text); font:inherit; }",
  "    textarea { min-height:92px; resize:vertical; }",
  "    button { width:auto; min-width:200px; border:none; background:var(--text); color:var(--panel); cursor:pointer; }",
  "    .actions { display:flex; gap:12px; align-items:center; margin-top:16px; }",
  "    .hidden { display:none; }",
  "    .error { border-color:var(--danger); color:var(--danger); background:var(--soft); }",
  "    .artifacts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:16px; }",
  "    .artifact { display:block; padding:12px; border:1px solid var(--line); color:inherit; text-decoration:none; background:#fff; }",
  "    .artifact:hover { border-color:var(--accent); }",
  "    ul { margin:12px 0 0; padding:0; }",
  "    li { list-style:none; padding:8px 0; border-top:1px solid var(--line); }",
  "    li:first-child { border-top:none; padding-top:0; }",
  "    pre { margin:16px 0 0; padding:14px; border:1px solid var(--line); background:#fff; overflow:auto; white-space:pre-wrap; word-break:break-word; }",
  "    .section { margin-top:24px; padding-top:24px; border-top:1px solid var(--line); }",
  "    .section:first-child { margin-top:0; padding-top:0; border-top:none; }",
  "    @media (max-width:900px) { .grid,.artifacts { grid-template-columns:1fr; } .actions { flex-direction:column; align-items:flex-start; } }",
  "  </style>",
  "</head>",
  "<body>",
  "  <main>",
  "    <section class=\"panel\">",
  "      <p class=\"eyebrow\">Git + .NET</p>",
  "      <h1>增量部署包测试页</h1>",
  "      <p style=\"margin-top:12px\">这个独立页面调用与工作区相同的增量构建后端。</p>",
  "      <p class=\"muted\" style=\"margin-top:8px\">起始提交留空时，系统会自动取目标提交的上一个提交。如果仓库里存在多个可部署项目，后端会根据提交改动自动识别并批量生成对应项目的增量包。</p>",
  "    </section>",
  "    <section class=\"panel\">",
  "      <h2>构建参数</h2>",
  "      <form id=\"form\">",
  "        <div class=\"grid\">",
  "          <label><span>Git 仓库地址</span><input name=\"repo\" required placeholder=\"https://github.com/your-org/your-repo.git\" /></label>",
  "          <label><span>起始提交 / 标签</span><input name=\"from\" placeholder=\"留空则自动取上一个提交\" /></label>",
  "          <label><span>目标提交 / 标签</span><input name=\"to\" required placeholder=\"HEAD 或 9d8c7b6\" /></label>",
  "          <label><span>项目文件</span><input name=\"project\" placeholder=\"可选，仅用于强制指定单个项目，例如 src/MyApi/MyApi.csproj\" /></label>",
  "          <label><span>项目类型</span><select name=\"kind\"><option value=\"auto\">自动识别</option><option value=\"aspnet-web\">ASP.NET Web</option><option value=\"mvc-api\">MVC API</option><option value=\"winforms\">WinForms</option></select></label>",
  "          <label><span>构建配置</span><input name=\"configuration\" value=\"Release\" /></label>",
  "        </div>",
  "        <label style=\"margin-top:12px\"><span>额外 publish 参数</span><textarea name=\"publish_args\" placeholder=\"-r win-x64 --self-contained false /p:PublishSingleFile=false\"></textarea></label>",
  "        <div class=\"actions\">",
  "          <button id=\"submit\" type=\"submit\">生成增量包</button>",
  "          <p class=\"muted\">增量包基于 publish 输出差异生成，不是直接打包源码改动文件。</p>",
  "        </div>",
  "      </form>",
  "    </section>",
  "    <section id=\"busy\" class=\"panel hidden\">正在生成增量包。克隆仓库和发布过程可能需要几分钟。</section>",
  "    <section id=\"error\" class=\"panel error hidden\"></section>",
  "    <section id=\"result\" class=\"panel hidden\"></section>",
  "  </main>",
  "  <script>",
  "    const form = document.getElementById('form')",
  "    const busy = document.getElementById('busy')",
  "    const error = document.getElementById('error')",
  "    const result = document.getElementById('result')",
  "    const submit = document.getElementById('submit')",
  "    const esc = (value) => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\\\"', '&quot;')",
  "    const size = (value) => value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(2) + ' MB' : value >= 1024 ? (value / 1024).toFixed(1) + ' KB' : value + ' B'",
  "    const list = (items) => (items || []).map((item) => '<li>' + esc(item) + '</li>').join('')",
  "    const renderArtifacts = (items) => (items || []).map((item) => '<a class=\\\"artifact\\\" href=\\\"' + esc(item.url) + '\\\"><strong>' + esc(item.label) + '</strong><div class=\\\"muted\\\">' + esc(item.name) + '</div><div style=\\\"margin-top:8px;color:var(--accent)\\\">' + esc(size(item.size)) + '</div></a>').join('')",
  "    const showError = (message, candidates) => {",
  "      const rows = Array.isArray(candidates) && candidates.length ? '<h3 style=\\\"margin-top:12px\\\">候选项目</h3><ul>' + candidates.map((item) => '<li><code>' + esc(item.path) + '</code> ' + esc(item.title) + '<div class=\\\"muted\\\">' + esc(item.reason) + '</div></li>').join('') + '</ul>' : ''",
  "      error.innerHTML = '<strong>请求失败</strong><div style=\\\"margin-top:8px\\\">' + esc(message) + '</div>' + rows",
  "      error.classList.remove('hidden')",
  "      result.classList.add('hidden')",
  "    }",
  "    const renderProject = (body, index, shared) => {",
  "      const artifacts = renderArtifacts(body.artifacts || [])",
  "      const warnings = (body.warnings || []).filter((item) => !(shared || []).includes(item))",
  "      return [",
  "        '<div class=\\\"section\\\">',",
  "        index == null ? '<p class=\\\"eyebrow\\\">任务 ' + esc(body.job) + '</p>' : '<p class=\\\"eyebrow\\\">项目 ' + esc(index + 1) + '</p>',",
  "        '<h2>' + esc(body.project.title) + ' 构建结果</h2>',",
  "        '<p class=\\\"muted\\\" style=\\\"margin-top:8px\\\"><code>' + esc(body.from.short) + '</code> -> <code>' + esc(body.to.short) + '</code></p>',",
  "        '<ul>',",
  "        '<li><strong>项目</strong><div><code>' + esc(body.project.path) + '</code></div></li>',",
  "        '<li><strong>构建工具</strong><div>' + esc(body.project.build_tool) + '</div></li>',",
  "        '<li><strong>生成策略</strong><div>' + esc(body.strategy.mode) + '</div><div class=\\\"muted\\\">' + esc(body.strategy.reason) + '</div></li>',",
  "        '<li><strong>风险等级</strong><div>' + esc(String(body.risk || '').toUpperCase()) + '</div></li>',",
  "        '<li><strong>源码变更</strong><div>' + esc(body.source.total) + ' 个文件，+' + esc(body.source.additions) + '，-' + esc(body.source.deletions) + '</div></li>',",
  "        '<li><strong>输出变更</strong><div>' + esc(body.output.total) + ' 个文件，新增 ' + esc(body.output.add) + '，替换 ' + esc(body.output.replace) + '，删除 ' + esc(body.output.remove) + '</div></li>',",
  "        '</ul>',",
  "        artifacts ? '<h3 style=\\\"margin-top:16px\\\">产物下载</h3><div class=\\\"artifacts\\\">' + artifacts + '</div>' : '',",
  "        warnings.length ? '<h3 style=\\\"margin-top:16px\\\">项目警告</h3><ul>' + list(warnings) + '</ul>' : '',",
  "        '<h3 style=\\\"margin-top:16px\\\">部署命令</h3><pre><code>' + esc(body.command) + '</code></pre>',",
  "        '<h3 style=\\\"margin-top:16px\\\">原始结果 JSON</h3><pre><code>' + esc(JSON.stringify(body, null, 2)) + '</code></pre>',",
  "        '</div>',",
  "      ].join('')",
  "    }",
  "    const renderBatch = (body) => {",
  "      const artifacts = renderArtifacts(body.artifacts || [])",
  "      const warnings = list(body.warnings || [])",
  "      const projects = (body.results || []).map((item, index) => renderProject(item, index, body.warnings || [])).join('')",
  "      return [",
  "        '<p class=\\\"eyebrow\\\">任务 ' + esc(body.job) + '</p>',",
  "        '<h2>共生成 ' + esc((body.results || []).length) + ' 个项目的增量包</h2>',",
  "        '<p class=\\\"muted\\\" style=\\\"margin-top:8px\\\"><code>' + esc(body.from.short) + '</code> -> <code>' + esc(body.to.short) + '</code></p>',",
  "        artifacts ? '<h3 style=\\\"margin-top:16px\\\">批量摘要</h3><div class=\\\"artifacts\\\">' + artifacts + '</div>' : '',",
  "        warnings ? '<h3 style=\\\"margin-top:16px\\\">公共警告</h3><ul>' + warnings + '</ul>' : '',",
  "        projects,",
  "      ].join('')",
  "    }",
  "    const render = (body) => Array.isArray(body.results) ? renderBatch(body) : renderProject(body)",
  "    form.addEventListener('submit', async (event) => {",
  "      event.preventDefault()",
  "      busy.classList.remove('hidden')",
  "      error.classList.add('hidden')",
  "      result.classList.add('hidden')",
  "      submit.disabled = true",
  "      submit.textContent = '生成中...'",
  "      const data = Object.fromEntries(new FormData(form).entries())",
  "      if (!data.from) delete data.from",
  "      if (!data.project) delete data.project",
  "      if (!data.publish_args) delete data.publish_args",
  "      try {",
  "        const response = await fetch('/api/delta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })",
  "        const body = await response.json().catch(() => ({}))",
  "        if (!response.ok) {",
  "          showError(body.error || '请求失败', body.candidates || [])",
  "          return",
  "        }",
  "        result.innerHTML = render(body)",
  "        result.classList.remove('hidden')",
  "      } catch (err) {",
  "        showError(err && err.message ? err.message : '请求失败')",
  "      } finally {",
  "        busy.classList.add('hidden')",
  "        submit.disabled = false",
  "        submit.textContent = '生成增量包'",
  "      }",
  "    })",
  "  </script>",
  "</body>",
  "</html>",
].join("\n")

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

function fail(error: unknown) {
  if (error instanceof Error) {
    const status = "status" in error && typeof error.status === "number" ? error.status : 500
    const candidates = "candidates" in error && Array.isArray(error.candidates) ? error.candidates : undefined
    return json({ error: error.message, candidates }, status)
  }

  return json({ error: String(error) }, 500)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + port)

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(302, {
        location: "http://" + (url.hostname || "127.0.0.1") + ":3000/login",
      })
      res.end()
      return
    }

    if (req.method === "GET" && url.pathname === "/delta-test") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(page)
      return
    }

    if (url.pathname === "/api/delta" && req.method === "GET") {
      const job = url.searchParams.get("job")?.trim()
      const file = url.searchParams.get("file")?.trim()

      if (!job) {
        const body = await json({ error: "请提供 job 参数。" }, 400).text()
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" })
        res.end(body)
        return
      }

      if (file) {
        const asset = await fileDelta(job, file)
        res.writeHead(200, {
          "content-type": asset.type,
          "content-disposition": "attachment; filename=\"" + asset.name.split("/").at(-1) + "\"",
        })
        res.end(asset.body)
        return
      }

      const body = await readDelta(job)
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(body, null, 2))
      return
    }

    if (url.pathname === "/api/delta" && req.method === "POST") {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const body = await createDelta(input)
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(body, null, 2))
      return
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    res.end("未找到页面")
  } catch (error) {
    const response = fail(error)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(await response.text())
  }
}).listen(port, "127.0.0.1", () => {
  console.log("delta preview: http://127.0.0.1:" + port + "/delta-test")
})
