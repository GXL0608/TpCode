import { dict as en } from "@/i18n/en"

type Translate = (key: keyof typeof en, args?: Record<string, string | number>) => string

export type ArchivePreview = {
  dirty?: boolean
  has_workspace?: boolean
} | undefined

export const archiveNeedsForce = (preview: ArchivePreview) => !!preview?.has_workspace && !!preview.dirty

export const archiveDirtyCount = (previews: ArchivePreview[]) => previews.filter(archiveNeedsForce).length

export const archiveConfirmMessage = (t: Translate, count = 1) =>
  count > 1
    ? t("session.archive.confirm.clear.many", { count })
    : t("session.archive.confirm.clear.one")

export async function archiveWithConfirm(input: {
  t: Translate
  preview: () => Promise<ArchivePreview>
  archive: (force: boolean) => Promise<void>
  confirm?: (message: string) => boolean
}) {
  const preview = await input.preview()
  const force = archiveNeedsForce(preview)
  if (force) {
    const ok = input.confirm ? input.confirm(archiveConfirmMessage(input.t)) : true
    if (!ok) return false
  }
  await input.archive(force)
  return true
}
