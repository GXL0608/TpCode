CREATE TABLE "tp_prototype_asset" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "message_id" text,
  "user_id" text,
  "org_id" text,
  "department_id" text,
  "agent_mode" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "route" text,
  "page_key" text NOT NULL,
  "viewport_width" integer,
  "viewport_height" integer,
  "device_scale_factor" integer,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_driver" text NOT NULL,
  "storage_key" text NOT NULL,
  "image_url" text,
  "thumbnail_url" text,
  "source_type" text NOT NULL,
  "source_url" text,
  "test_run_id" text,
  "test_result" text,
  "version" integer NOT NULL,
  "is_latest" integer NOT NULL,
  "status" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "fk_tp_prototype_asset_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_tp_prototype_asset_user_id_tp_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "tp_user"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_tp_prototype_asset_org_id_tp_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "tp_organization"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_tp_prototype_asset_department_id_tp_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "tp_department"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_session_idx" ON "tp_prototype_asset" ("session_id");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_message_idx" ON "tp_prototype_asset" ("message_id");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_user_idx" ON "tp_prototype_asset" ("user_id");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_org_idx" ON "tp_prototype_asset" ("org_id");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_page_idx" ON "tp_prototype_asset" ("session_id", "page_key");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_latest_idx" ON "tp_prototype_asset" ("session_id", "page_key", "is_latest");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_status_idx" ON "tp_prototype_asset" ("status");
--> statement-breakpoint
CREATE INDEX "tp_prototype_asset_created_idx" ON "tp_prototype_asset" ("time_created");
--> statement-breakpoint
CREATE UNIQUE INDEX "tp_prototype_asset_session_page_version_uidx" ON "tp_prototype_asset" ("session_id", "page_key", "version");
