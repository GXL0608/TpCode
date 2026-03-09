export type ProviderSettingsScope =
  | { kind: "local" }
  | { kind: "self" }
  | { kind: "global" }
  | { kind: "user"; userID: string; userName?: string }
