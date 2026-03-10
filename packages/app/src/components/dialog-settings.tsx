import { Component, Show, createMemo } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useAccountAuth } from "@/context/account-auth"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsAccount } from "./settings-account"
import { SettingsUsers } from "./settings-users"
import { SettingsRoles } from "./settings-roles"
import { SettingsSystem } from "./settings-system"
import { SettingsProjects } from "./settings-projects"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const auth = useAccountAuth()
  const isSuperAdmin = createMemo(() => (auth.user()?.roles ?? []).includes("super_admin"))
  const canManageUsers = createMemo(() => auth.has("user:manage"))
  const canManageRoles = createMemo(() => auth.has("role:manage"))
  const canManageProjects = createMemo(() => auth.has("role:manage"))
  const canManageSystem = createMemo(() => auth.has("role:manage"))
  const canViewProviders = createMemo(() => isSuperAdmin())

  return (
    <Dialog size="xx-large" transition>
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Show when={canViewProviders()}>
                      <Tabs.Trigger value="providers">
                        <Icon name="providers" />
                        {language.t("settings.providers.title")}
                      </Tabs.Trigger>
                    </Show>
                    <Tabs.Trigger value="my">
                      <Icon name="sliders" />
                      我的
                    </Tabs.Trigger>
                    <Show when={canManageUsers()}>
                      <Tabs.Trigger value="users">
                        <Icon name="providers" />
                        用户管理
                      </Tabs.Trigger>
                    </Show>
                    <Show when={canManageRoles()}>
                      <Tabs.Trigger value="roles">
                        <Icon name="check" />
                        角色管理
                      </Tabs.Trigger>
                    </Show>
                    <Show when={canManageProjects()}>
                      <Tabs.Trigger value="projects">
                        <Icon name="folder-add-left" />
                        项目管理
                      </Tabs.Trigger>
                    </Show>
                    <Show when={canManageSystem()}>
                      <Tabs.Trigger value="system">
                        <Icon name="sliders" />
                        系统设置
                      </Tabs.Trigger>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Show when={canViewProviders()}>
          <Tabs.Content value="providers" class="no-scrollbar">
            <SettingsProviders />
          </Tabs.Content>
        </Show>
        <Tabs.Content value="my" class="no-scrollbar">
          <SettingsAccount />
        </Tabs.Content>
        <Show when={canManageUsers()}>
          <Tabs.Content value="users" class="no-scrollbar">
            <SettingsUsers />
          </Tabs.Content>
        </Show>
        <Show when={canManageRoles()}>
          <Tabs.Content value="roles" class="no-scrollbar">
            <SettingsRoles />
          </Tabs.Content>
        </Show>
        <Show when={canManageProjects()}>
          <Tabs.Content value="projects" class="no-scrollbar">
            <SettingsProjects />
          </Tabs.Content>
        </Show>
        <Show when={canManageSystem()}>
          <Tabs.Content value="system" class="no-scrollbar">
            <SettingsSystem />
          </Tabs.Content>
        </Show>
      </Tabs>
    </Dialog>
  )
}
