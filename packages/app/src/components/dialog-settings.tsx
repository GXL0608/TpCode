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
import { SettingsModels } from "./settings-models"
import { SettingsAccount } from "./settings-account"
import { SettingsUsers } from "./settings-users"
import { SettingsRoles } from "./settings-roles"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const auth = useAccountAuth()
  const canManageAccount = createMemo(() => auth.has("user:manage") && auth.has("role:manage"))

  return (
    <Dialog size="x-large" transition>
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
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="my">
                      <Icon name="sliders" />
                      我的
                    </Tabs.Trigger>
                    <Show when={canManageAccount()}>
                      <Tabs.Trigger value="users">
                        <Icon name="providers" />
                        用户管理
                      </Tabs.Trigger>
                      <Tabs.Trigger value="roles">
                        <Icon name="check" />
                        角色管理
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
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="my" class="no-scrollbar">
          <SettingsAccount />
        </Tabs.Content>
        <Show when={canManageAccount()}>
          <Tabs.Content value="users" class="no-scrollbar">
            <SettingsUsers />
          </Tabs.Content>
          <Tabs.Content value="roles" class="no-scrollbar">
            <SettingsRoles />
          </Tabs.Content>
        </Show>
      </Tabs>
    </Dialog>
  )
}
