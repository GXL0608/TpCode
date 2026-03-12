CREATE TABLE "tp_user_provider_setting" (
  "user_id" text PRIMARY KEY NOT NULL,
  "provider_auth_cipher" text,
  "provider_control_json" text,
  "provider_configs_json" text,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "fk_tp_user_provider_setting_user_id_tp_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "tp_user"("id") ON DELETE CASCADE
);
