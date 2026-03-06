import "@/index.css"
import { File } from "@opencode-ai/ui/file"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { MetaProvider } from "@solidjs/meta"
import { Navigate, Route, Router } from "@solidjs/router"
import { ErrorBoundary, type JSX, lazy, type ParentProps, Show, Suspense } from "solid-js"
import { AccountAuthProvider, useAccountAuth } from "@/context/account-auth"
import { AccountProjectProvider } from "@/context/account-project"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { type ServerConnection, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const AccountProjectSelect = lazy(() => import("@/pages/account-project-select"))
const AccountLogin = lazy(() => import("@/pages/account-login"))
const AccountRegister = lazy(() => import("@/pages/account-register"))
const AccountForgot = lazy(() => import("@/pages/account-forgot"))
const AccountReset = lazy(() => import("@/pages/account-reset"))
const AccountAdmin = lazy(() => import("@/pages/account-admin"))
const AccountApiKeys = lazy(() => import("@/pages/account-apikeys"))
const AccountPasswordChange = lazy(() => import("@/pages/account-password-change"))
const ApprovalWorkflow = lazy(() => import("@/pages/approval-workflow"))
const Loading = () => <div class="size-full" />

const HomeRoute = () => (
  <Suspense fallback={<Loading />}>
    <Home />
  </Suspense>
)

const SessionRoute = () => (
  <SessionProviders>
    <Suspense fallback={<Loading />}>
      <Session />
    </Suspense>
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />

const AccountLoginRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountLogin />
  </Suspense>
)

const AccountRegisterRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountRegister />
  </Suspense>
)

const AccountForgotRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountForgot />
  </Suspense>
)

const AccountResetRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountReset />
  </Suspense>
)

const ProjectSelectRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountProjectSelect />
  </Suspense>
)

const AccountAdminRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountAdmin />
  </Suspense>
)

const AccountApiKeysRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountApiKeys />
  </Suspense>
)

const AccountPasswordChangeRoute = () => (
  <Suspense fallback={<Loading />}>
    <AccountPasswordChange />
  </Suspense>
)

const ApprovalWorkflowRoute = () => (
  <Suspense fallback={<Loading />}>
    <ApprovalWorkflow />
  </Suspense>
)

function ProtectedRoute(props: ParentProps) {
  const auth = useAccountAuth()
  return (
    <Show when={auth.ready()} fallback={<Loading />}>
      <Show when={!auth.enabled() || auth.authenticated()} fallback={<Navigate href="/login" />}>
        {props.children}
      </Show>
    </Show>
  )
}

function PublicAccountRoute(props: ParentProps) {
  const auth = useAccountAuth()
  return (
    <Show when={auth.ready()} fallback={<Loading />}>
      <Show when={auth.enabled() && !auth.authenticated()} fallback={<Navigate href="/" />}>
        {props.children}
      </Show>
    </Show>
  )
}

function ContextProtectedRoute(props: ParentProps) {
  const auth = useAccountAuth()
  return (
    <Show when={auth.ready()} fallback={<Loading />}>
      <Show when={!auth.enabled() || !auth.needsProjectContext()} fallback={<Navigate href="/project-select" />}>
        {props.children}
      </Show>
    </Show>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <AccountProjectProvider>
          <LayoutProvider>
            <NotificationProvider>
              <ModelsProvider>
                <CommandProvider>
                  <HighlightsProvider>
                    <Layout>{props.children}</Layout>
                  </HighlightsProvider>
                </CommandProvider>
              </ModelsProvider>
            </NotificationProvider>
          </LayoutProvider>
        </AccountProjectProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {props.appChildren}
      {props.children}
    </AppShellProviders>
  )
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
}) {
  const ProtectedShell = (shellProps: ParentProps) => (
    <ProtectedRoute>
      <ContextProtectedRoute>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <RouterRoot appChildren={props.children}>{shellProps.children}</RouterRoot>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ContextProtectedRoute>
    </ProtectedRoute>
  )

  const SelectShell = (shellProps: ParentProps) => <ProtectedRoute>{shellProps.children}</ProtectedRoute>

  const AccountOnlyShell = (shellProps: ParentProps) => (
    <ProtectedRoute>
      {shellProps.children}
    </ProtectedRoute>
  )

  return (
    <ServerProvider defaultServer={props.defaultServer} servers={props.servers}>
      <ServerKey>
        <AccountAuthProvider>
          <Router>
            <Route
              path="/login"
              component={() => (
                <PublicAccountRoute>
                  <AccountLoginRoute />
                </PublicAccountRoute>
              )}
            />
            <Route
              path="/register"
              component={() => (
                <PublicAccountRoute>
                  <AccountRegisterRoute />
                </PublicAccountRoute>
              )}
            />
            <Route
              path="/password/forgot"
              component={() => (
                <PublicAccountRoute>
                  <AccountForgotRoute />
                </PublicAccountRoute>
              )}
            />
            <Route
              path="/password/reset"
              component={() => (
                <PublicAccountRoute>
                  <AccountResetRoute />
                </PublicAccountRoute>
              )}
            />
            <Route
              path="/"
              component={() => (
                <ProtectedShell>
                  <HomeRoute />
                </ProtectedShell>
              )}
            />
            <Route
              path="/project-select"
              component={() => (
                <SelectShell>
                  <ProjectSelectRoute />
                </SelectShell>
              )}
            />
            <Route
              path="/settings/account-admin"
              component={() => (
                <AccountOnlyShell>
                  <AccountAdminRoute />
                </AccountOnlyShell>
              )}
            />
            <Route
              path="/settings/apikeys"
              component={() => (
                <AccountOnlyShell>
                  <AccountApiKeysRoute />
                </AccountOnlyShell>
              )}
            />
            <Route
              path="/settings/security"
              component={() => (
                <AccountOnlyShell>
                  <AccountPasswordChangeRoute />
                </AccountOnlyShell>
              )}
            />
            <Route
              path="/approval"
              component={() => (
                <AccountOnlyShell>
                  <ApprovalWorkflowRoute />
                </AccountOnlyShell>
              )}
            />
            <Route
              path="/:dir"
              component={(routeProps) => (
                <ProtectedShell>
                  <DirectoryLayout {...routeProps} />
                </ProtectedShell>
              )}
            >
              <Route path="" component={SessionIndexRoute} />
              <Route path="session/:id?" component={SessionRoute} />
            </Route>
          </Router>
        </AccountAuthProvider>
      </ServerKey>
    </ServerProvider>
  )
}
