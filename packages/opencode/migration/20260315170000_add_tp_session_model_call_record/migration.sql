CREATE TABLE "tp_session_model_call_record" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "teacher_user_message_id" text NOT NULL,
  "teacher_assistant_message_id" text,
  "teacher_provider_id" text NOT NULL,
  "teacher_model_id" text NOT NULL,
  "teacher_agent" text NOT NULL,
  "request_protocol" text,
  "request_text" text,
  "response_text" text,
  "reasoning_text" text,
  "usage_text" text,
  "meta_text" text,
  "student_provider_id" text,
  "student_model_id" text,
  "student_request_protocol" text,
  "student_status" text,
  "student_error_code" text,
  "student_error_message" text,
  "student_response_text" text,
  "student_reasoning_text" text,
  "student_usage_text" text,
  "status" text NOT NULL,
  "error_code" text,
  "error_message" text,
  "finished_at" bigint,
  "student_finished_at" bigint,
  "time_created" bigint NOT NULL DEFAULT extract(epoch from now()) * 1000,
  "time_updated" bigint NOT NULL DEFAULT extract(epoch from now()) * 1000,
  CONSTRAINT "fk_tp_session_model_call_record_session_id_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_tp_session_model_call_record_teacher_user_message_id_message_id_fk"
    FOREIGN KEY ("teacher_user_message_id") REFERENCES "message"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_tp_session_model_call_record_teacher_assistant_message_id_message_id_fk"
    FOREIGN KEY ("teacher_assistant_message_id") REFERENCES "message"("id") ON DELETE SET NULL
);
--> statement-breakpoint
COMMENT ON TABLE "tp_session_model_call_record" IS '会话统一模型调用记录表';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."id" IS '主键标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."session_id" IS '所属会话标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."teacher_user_message_id" IS '触发本轮模型调用的教师侧用户消息标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."teacher_assistant_message_id" IS '本轮最终关联的教师侧助手消息标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."teacher_provider_id" IS '教师模型供应商标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."teacher_model_id" IS '教师模型标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."teacher_agent" IS '教师侧代理模式';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."request_protocol" IS '教师模型最终请求使用的渠道商协议';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."request_text" IS '教师模型最终发给渠道商的原始请求体';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."response_text" IS '教师模型最终回复文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."reasoning_text" IS '教师模型最终思考文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."usage_text" IS '教师模型调用用量信息文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."meta_text" IS '非敏感内部采集元数据文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_provider_id" IS '学生模型供应商标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_model_id" IS '学生模型标识';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_request_protocol" IS '学生模型最终请求使用的渠道商协议';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_status" IS '学生模型采样状态';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_error_code" IS '学生模型失败错误代码';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_error_message" IS '学生模型失败错误消息';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_response_text" IS '学生模型最终回复文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_reasoning_text" IS '学生模型最终思考文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_usage_text" IS '学生模型调用用量信息文本';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."status" IS '教师模型采集状态';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."error_code" IS '教师模型失败错误代码';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."error_message" IS '教师模型失败错误消息';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."finished_at" IS '教师模型本轮完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."student_finished_at" IS '学生模型采样完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."time_created" IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "tp_session_model_call_record"."time_updated" IS '记录更新时间';
--> statement-breakpoint
CREATE INDEX "tp_session_model_call_record_session_time_idx" ON "tp_session_model_call_record" ("session_id", "time_created");
--> statement-breakpoint
CREATE INDEX "tp_session_model_call_record_user_message_idx" ON "tp_session_model_call_record" ("teacher_user_message_id");
--> statement-breakpoint
CREATE INDEX "tp_session_model_call_record_assistant_message_idx" ON "tp_session_model_call_record" ("teacher_assistant_message_id");
--> statement-breakpoint
CREATE INDEX "tp_session_model_call_record_status_time_idx" ON "tp_session_model_call_record" ("status", "time_created");
