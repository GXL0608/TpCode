COMMENT ON TABLE `tp_saved_plan` IS 'Plan 智能体输出的已保存计划快照表';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`id` IS '主键ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`session_id` IS '会话ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`message_id` IS '消息ID（assistant消息）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`part_id` IS '消息分片ID（被保存的文本part）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`project_id` IS '项目ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`project_name` IS '保存时的项目名称快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`project_worktree` IS '保存时的项目工作目录快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`session_title` IS '保存时的会话标题快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`user_id` IS '保存操作用户ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`username` IS '保存时的用户名快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`display_name` IS '保存时的显示名称快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`account_type` IS '保存时的账号类型快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`org_id` IS '保存时的组织ID快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`department_id` IS '保存时的部门ID快照';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`agent` IS '生成计划的智能体编码';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`provider_id` IS '模型提供方ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`model_id` IS '模型ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`message_created_at` IS '原始assistant消息创建时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`plan_content` IS '保存的计划文本内容';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`vho_feedback_no` IS 'VHO反馈号（可选）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`time_created` IS '记录创建时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan`.`time_updated` IS '记录更新时间戳（毫秒）';
