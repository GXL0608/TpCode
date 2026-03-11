import { Project } from "@/project/project"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Database, eq } from "@/storage/db"
import { ulid } from "ulid"
import { TpSavedPlanTable } from "./saved-plan.sql"
import { PlanEvalService } from "./eval-service"
import { SessionTable } from "@/session/session.sql"
import { AccountContextService } from "@/user/context"
import { TaskFeedbackService } from "./task-feedback"

type Actor = {
  id: string
  username: string
  display_name: string
  account_type: string
  org_id: string
  department_id?: string
  context_project_id?: string
}

function pickPart(input: { parts: MessageV2.Part[]; part_id?: string }) {
  const parts = input.parts.filter((part): part is MessageV2.TextPart => part.type === "text")
  if (input.part_id) {
    const hit = parts.find((part) => part.id === input.part_id)
    if (!hit) return { ok: false as const, code: "part_missing" as const }
    if (!hit.text.trim()) return { ok: false as const, code: "plan_text_missing" as const }
    return { ok: true as const, part: hit }
  }
  if (parts.length === 0) return { ok: false as const, code: "part_missing" as const }
  const hit = parts.filter((part) => !!part.text.trim()).at(-1)
  if (!hit) return { ok: false as const, code: "plan_text_missing" as const }
  return { ok: true as const, part: hit }
}

export namespace PlanService {
  export async function save(input: {
    session_id: string
    message_id: string
    part_id?: string
    project_id?: string
    vho_feedback_no?: string
    actor: Actor
  }) {
    const session = await Session.get(input.session_id).catch(() => undefined)
    if (!session) return { ok: false as const, code: "session_missing" as const }
    const session_row = await Database.use((db) =>
      db
        .select({
          project_id: SessionTable.project_id,
          context_project_id: SessionTable.context_project_id,
          directory: SessionTable.directory,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.session_id))
        .get(),
    )
    if (!session_row) return { ok: false as const, code: "session_missing" as const }

    const message = await MessageV2.get({
      sessionID: input.session_id,
      messageID: input.message_id,
    }).catch(() => undefined)
    if (!message) return { ok: false as const, code: "message_missing" as const }
    if (message.info.role !== "assistant") return { ok: false as const, code: "plan_message_required" as const }
    if (message.info.agent !== "plan") return { ok: false as const, code: "plan_message_required" as const }
    const info = message.info

    const selected = pickPart({
      parts: message.parts,
      part_id: input.part_id,
    })
    if (!selected.ok) return selected

    const explicit_project_id = input.project_id?.trim()
    if (explicit_project_id) {
      const allowed = await AccountContextService.canAccessProject({
        user_id: input.actor.id,
        project_id: explicit_project_id,
      })
      if (!allowed) return { ok: false as const, code: "project_forbidden" as const }
    }
    const fallback_project_id = input.actor.context_project_id ?? session_row.context_project_id ?? session_row.project_id
    const project =
      (explicit_project_id ? await Project.get(explicit_project_id).catch(() => undefined) : undefined) ??
      (fallback_project_id ? await Project.get(fallback_project_id).catch(() => undefined) : undefined)
    if (explicit_project_id && !project) return { ok: false as const, code: "project_missing" as const }
    const effective_project_id = project?.id ?? fallback_project_id
    const now = Date.now()
    const id = ulid()
    const vho_feedback_no = input.vho_feedback_no?.trim()
    const project_name = project?.name?.trim() ? project.name : effective_project_id
    const department_id = input.actor.department_id?.trim()
    await Database.use(async (db) => {
      await db.insert(TpSavedPlanTable)
        .values({
          id,
          session_id: input.session_id,
          message_id: input.message_id,
          part_id: selected.part.id,
          project_id: effective_project_id,
          project_name,
          project_worktree: project?.worktree ?? session_row.directory,
          session_title: session.title,
          user_id: input.actor.id,
          username: input.actor.username,
          display_name: input.actor.display_name,
          account_type: input.actor.account_type,
          org_id: input.actor.org_id,
          department_id: department_id ? department_id : "",
          agent: info.agent,
          provider_id: info.providerID,
          model_id: info.modelID,
          message_created_at: info.time.created,
          plan_content: selected.part.text,
          vho_feedback_no: vho_feedback_no ? vho_feedback_no : undefined,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    if (vho_feedback_no) {
      void TaskFeedbackService.markAiPlanLater({
        vho_feedback_no,
        plan_id: id,
        session_id: input.session_id,
        message_id: input.message_id,
      })
    }
    PlanEvalService.start({
      plan_id: id,
      session_id: input.session_id,
      user_id: input.actor.id,
      message_id: input.message_id,
      part_id: selected.part.id,
      vho_feedback_no: vho_feedback_no ? vho_feedback_no : undefined,
      user_model_provider_id: "",
      user_model_id: "",
      assistant_model_provider_id: info.providerID,
      assistant_model_id: info.modelID,
    })
    return {
      ok: true as const,
      id,
      saved_at: now,
      session_id: input.session_id,
      message_id: input.message_id,
      part_id: selected.part.id,
    }
  }
}
