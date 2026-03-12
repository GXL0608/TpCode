import type { Message, Session, Part, FileDiff, SessionStatus, ProviderListResponse } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type Data = {
  provider?: ProviderListResponse
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export type SavePlanSuccess = {
  ok: true
  id: string
  saved_at: number
  session_id: string
  message_id: string
  part_id: string
}

export type SavePlanFn = (input: {
  sessionID: string
  messageID: string
  partID: string
}) => Promise<
  SavePlanSuccess | {
    ok: false
    code?: string
    message?: string
    id?: string
    saved_at?: number
    session_id?: string
    message_id?: string
    part_id?: string
  }
>

export type AfterSavePlanFn = (input: SavePlanSuccess) => void | Promise<void>

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onSavePlan?: SavePlanFn
    onAfterSavePlan?: AfterSavePlanFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      savePlan: props.onSavePlan,
      afterSavePlan: props.onAfterSavePlan,
    }
  },
})
