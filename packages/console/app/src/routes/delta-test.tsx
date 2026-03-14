import "./delta-test.css"
import { Title, Meta } from "@solidjs/meta"
import { For, Show, createMemo, createSignal } from "solid-js"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"

type Candidate = {
  path: string
  name: string
  kind: "aspnet-web" | "mvc-api" | "winforms" | "dotnet"
  title: string
  reason: string
}

type Result = {
  job: string
  created_at: string
  repo: string
  from: { input: string; resolved: string; short: string }
  to: { input: string; resolved: string; short: string }
  project: {
    path: string
    name: string
    kind: "aspnet-web" | "mvc-api" | "winforms" | "dotnet"
    title: string
    configuration: string
  }
  strategy: {
    mode: "delta-preferred" | "full-preferred"
    reason: string
  }
  risk: "low" | "medium" | "high"
  warnings: string[]
  source: {
    total: number
    additions: number
    deletions: number
    blockers: string[]
    files: Array<{
      path: string
      status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown"
      previous?: string
    }>
  }
  output: {
    total: number
    add: number
    replace: number
    remove: number
    files: Array<{
      path: string
      type: "add" | "replace" | "remove"
    }>
  }
  command: string
  artifacts: Array<{
    name: string
    label: string
    url: string
    size: number
  }>
}

type Form = {
  repo: string
  from: string
  to: string
  project: string
  kind: "auto" | "aspnet-web" | "mvc-api" | "winforms"
  configuration: string
  publish_args: string
}

function size(input: number) {
  if (input >= 1024 * 1024) return `${(input / 1024 / 1024).toFixed(2)} MB`
  if (input >= 1024) return `${(input / 1024).toFixed(1)} KB`
  return `${input} B`
}

function sourceLabel(input: Result["source"]["files"][number]["status"]) {
  if (input === "added") return "新增"
  if (input === "modified") return "修改"
  if (input === "deleted") return "删除"
  if (input === "renamed") return "重命名"
  if (input === "copied") return "复制"
  return "未知"
}

function outputLabel(input: Result["output"]["files"][number]["type"]) {
  if (input === "add") return "新增"
  if (input === "replace") return "替换"
  return "删除"
}

export default function DeltaTest() {
  const [form, setForm] = createSignal<Form>({
    repo: "",
    from: "",
    to: "",
    project: "",
    kind: "auto",
    configuration: "Release",
    publish_args: "",
  })
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [candidates, setCandidates] = createSignal<Candidate[]>([])
  const [result, setResult] = createSignal<Result>()
  const strategy = createMemo(() => (result()?.strategy.mode === "delta-preferred" ? "增量优先" : "全量优先"))

  const update = (field: keyof Form) => (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    setForm((prev) => ({ ...prev, [field]: target.value }))
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    setCandidates([])

    try {
      const response = await fetch("/api/delta", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repo: form().repo.trim(),
          from: form().from.trim(),
          to: form().to.trim(),
          project: form().project.trim() || undefined,
          kind: form().kind,
          configuration: form().configuration.trim() || "Release",
          publish_args: form().publish_args.trim() || undefined,
        }),
      })
      const data = (await response.json().catch(() => undefined)) as
        | Result
        | {
            error?: string
            candidates?: Candidate[]
          }
        | undefined

      if (!response.ok) {
        setResult(undefined)
        setError(data?.error || "生成失败，请检查仓库地址、提交号和 publish 参数。")
        setCandidates(Array.isArray(data?.candidates) ? data.candidates : [])
        return
      }

      setResult(data as Result)
    } catch (next) {
      console.error(next)
      setResult(undefined)
      setError("请求失败，请确认当前控制台服务支持本地 git / dotnet 执行。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main data-page="delta-test">
      <Title>Git 增量包测试</Title>
      <Meta
        name="description"
        content="输入 Git 仓库地址、提交区间和 .NET 项目路径，自动生成 ASP.NET、MVC API、WinForms 的增量部署包。"
      />

      <div data-component="container">
        <Header hideGetStarted />

        <div data-component="content">
          <section data-component="hero">
            <div data-slot="copy">
              <p data-slot="eyebrow">Git + .NET</p>
              <h1>增量部署包测试页</h1>
              <p data-slot="body">
                输入仓库地址、起止提交和项目文件路径，服务端会克隆仓库、执行两次 <code>dotnet publish</code>，再生成目录级差异包。
              </p>
            </div>

            <div data-component="hero-grid">
              <div data-component="hero-card">
                <strong>优先支持</strong>
                <p>ASP.NET Web、MVC API、WinForms 的单项目发布场景。</p>
              </div>
              <div data-component="hero-card">
                <strong>本机依赖</strong>
                <p>运行这个页面的机器需要可用的 `git` 和 `dotnet`。</p>
              </div>
              <div data-component="hero-card">
                <strong>保守策略</strong>
                <p>WinForms 仍默认标记为全量优先，但会额外给出增量测试包。</p>
              </div>
            </div>
          </section>

          <section data-component="workspace">
            <div data-component="panel">
              <div data-slot="panel-head">
                <h2>生成参数</h2>
                <p>项目路径建议直接填 `.csproj` 或 `.vbproj`，多项目仓库更稳。</p>
              </div>

              <form onSubmit={submit}>
                <div data-component="grid">
                  <label data-component="field">
                    <span>Git 地址</span>
                    <input
                      type="text"
                      placeholder="https://github.com/your-org/your-repo.git"
                      value={form().repo}
                      onInput={update("repo")}
                      required
                    />
                  </label>

                  <label data-component="field">
                    <span>起始提交 / 标签</span>
                    <input type="text" placeholder="例如 v1.0.0 或 1a2b3c4" value={form().from} onInput={update("from")} required />
                  </label>

                  <label data-component="field">
                    <span>目标提交 / 标签</span>
                    <input type="text" placeholder="例如 HEAD 或 9d8c7b6" value={form().to} onInput={update("to")} required />
                  </label>

                  <label data-component="field">
                    <span>项目文件</span>
                    <input
                      type="text"
                      placeholder="例如 src/MyApi/MyApi.csproj"
                      value={form().project}
                      onInput={update("project")}
                    />
                  </label>

                  <label data-component="field">
                    <span>项目类型</span>
                    <select value={form().kind} onChange={update("kind")}>
                      <option value="auto">自动识别</option>
                      <option value="aspnet-web">ASP.NET Web</option>
                      <option value="mvc-api">MVC API</option>
                      <option value="winforms">WinForms</option>
                    </select>
                  </label>

                  <label data-component="field">
                    <span>配置</span>
                    <input type="text" value={form().configuration} onInput={update("configuration")} placeholder="Release" />
                  </label>
                </div>

                <label data-component="field" data-wide>
                  <span>额外 publish 参数</span>
                  <textarea
                    rows={3}
                    placeholder='例如 -r win-x64 --self-contained false /p:PublishSingleFile=false'
                    value={form().publish_args}
                    onInput={update("publish_args")}
                  />
                </label>

                <div data-component="actions">
                  <button type="submit" disabled={busy()}>
                    {busy() ? "生成中..." : "生成增量包"}
                  </button>
                  <p>如果仓库里存在多个可部署项目，接口会返回候选路径，你可以直接复制回上面的项目文件框。</p>
                </div>
              </form>
            </div>

            <div data-component="panel" data-variant="side">
              <div data-slot="panel-head">
                <h2>使用提醒</h2>
              </div>

              <ul data-component="checklist">
                <li>页面会在临时目录克隆仓库，并切换到两个提交分别执行发布。</li>
                <li>增量包基于 publish 输出目录差异，不是源码 diff。</li>
                <li>如果命中 `.csproj`、`.sln`、`pubxml` 之类的配置文件，结果会标成高风险。</li>
                <li>WinForms 安装器场景仍建议保留全量包，本页更适合 xcopy 部署验证。</li>
              </ul>
            </div>
          </section>

          <Show when={busy()}>
            <section data-component="alert" data-state="busy">
              <strong>任务运行中</strong>
              <p>正在克隆仓库、切换提交并执行 `dotnet publish`，复杂项目会花几分钟。</p>
            </section>
          </Show>

          <Show when={error()}>
            <section data-component="alert" data-state="error">
              <strong>生成失败</strong>
              <p>{error()}</p>

              <Show when={candidates().length}>
                <div data-component="candidate-box">
                  <h3>检测到的候选项目</h3>
                  <ul>
                    <For each={candidates()}>
                      {(item) => (
                        <li>
                          <code>{item.path}</code>
                          <span>{item.title}</span>
                          <p>{item.reason}</p>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </section>
          </Show>

          <Show when={result()}>
            {(data) => (
              <section data-component="result">
                <div data-component="result-head">
                  <div>
                    <p data-slot="eyebrow">Job {data().job}</p>
                    <h2>{data().project.title} 增量结果</h2>
                    <p data-slot="body">
                      <code>{data().from.short}</code> → <code>{data().to.short}</code>，生成时间{" "}
                      {new Date(data().created_at).toLocaleString("zh-CN")}
                    </p>
                  </div>

                  <div data-component="badge-row">
                    <span data-kind="strategy">{strategy()}</span>
                    <span data-kind="risk" data-risk={data().risk}>
                      {data().risk.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div data-component="stats">
                  <div data-component="stat-card">
                    <strong>源码变更</strong>
                    <span>{data().source.total}</span>
                    <p>
                      +{data().source.additions} / -{data().source.deletions}
                    </p>
                  </div>

                  <div data-component="stat-card">
                    <strong>输出差异</strong>
                    <span>{data().output.total}</span>
                    <p>
                      新增 {data().output.add} / 替换 {data().output.replace} / 删除 {data().output.remove}
                    </p>
                  </div>

                  <div data-component="stat-card">
                    <strong>项目路径</strong>
                    <span>{data().project.name}</span>
                    <p>{data().project.path}</p>
                  </div>
                </div>

                <div data-component="panel-group">
                  <div data-component="panel">
                    <div data-slot="panel-head">
                      <h3>下载产物</h3>
                      <p>{data().strategy.reason}</p>
                    </div>

                    <div data-component="downloads">
                      <For each={data().artifacts}>
                        {(item) => (
                          <a href={item.url} data-component="download">
                            <strong>{item.label}</strong>
                            <span>{item.name}</span>
                            <label>{size(item.size)}</label>
                          </a>
                        )}
                      </For>
                    </div>
                  </div>

                  <div data-component="panel">
                    <div data-slot="panel-head">
                      <h3>应用命令</h3>
                      <p>下载 `delta.zip` 和 `apply-delta.ps1` 后，按目标目录替换下面命令里的路径。</p>
                    </div>

                    <pre data-component="command">
                      <code>{data().command}</code>
                    </pre>
                  </div>
                </div>

                <Show when={data().warnings.length || data().source.blockers.length}>
                  <div data-component="panel" data-variant="warn">
                    <div data-slot="panel-head">
                      <h3>风险提示</h3>
                    </div>

                    <ul data-component="warn-list">
                      <For each={data().warnings}>{(item) => <li>{item}</li>}</For>
                      <For each={data().source.blockers}>{(item) => <li>命中高风险文件: {item}</li>}</For>
                    </ul>
                  </div>
                </Show>

                <div data-component="panel-group">
                  <div data-component="panel">
                    <div data-slot="panel-head">
                      <h3>源码文件样本</h3>
                      <p>接口默认回传前 120 条，完整信息可在 `manifest.json` 和 `notes.md` 里查看。</p>
                    </div>

                    <ul data-component="list">
                      <For each={data().source.files}>
                        {(item) => (
                          <li>
                            <span data-kind="source">{sourceLabel(item.status)}</span>
                            <code>{item.path}</code>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>

                  <div data-component="panel">
                    <div data-slot="panel-head">
                      <h3>输出文件样本</h3>
                      <p>这些文件来自两个 publish 目录的实际差异。</p>
                    </div>

                    <ul data-component="list">
                      <For each={data().output.files}>
                        {(item) => (
                          <li>
                            <span data-kind="output">{outputLabel(item.type)}</span>
                            <code>{item.path}</code>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </div>
              </section>
            )}
          </Show>
        </div>

        <Footer />
      </div>

      <Legal />
    </main>
  )
}
