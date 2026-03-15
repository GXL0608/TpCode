import z from "zod"

export const BuildPackageMode = z.enum(["zip"])
export type BuildPackageMode = z.infer<typeof BuildPackageMode>

export const BuildProfile = z.object({
  workdirs: z.array(z.string()).default(["."]),
  install_command: z.string().optional(),
  compile_command: z.string().min(1),
  package_mode: BuildPackageMode.default("zip"),
  artifact_include: z.array(z.string()).default([]),
  artifact_exclude: z.array(z.string()).default([]),
  output_name_template: z.string().default("{{solution}}.zip"),
})
export type BuildProfile = z.infer<typeof BuildProfile>

/** 中文注释：统一把解决方案编译配置补齐默认值，避免服务层反复手动兼容空字段。 */
export function normalizeBuildProfile(input: unknown) {
  return BuildProfile.parse(input)
}
