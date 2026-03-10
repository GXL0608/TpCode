COMMENT ON TABLE `tp_saved_plan_eval` IS '已保存计划的质量评估主表';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`id` IS '评估记录主键';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`plan_id` IS '关联的已保存计划 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`vho_feedback_no` IS '保存计划时填写的反馈号';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`user_id` IS '保存计划的用户 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`session_id` IS '计划所属会话 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`user_message_id` IS '本轮对应的用户消息 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`assistant_message_id` IS '被保存计划对应的模型消息 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`part_id` IS '被保存计划对应的消息分片 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`status` IS '评估状态：running、completed、failed、skipped';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`rubric_version` IS '评分规则版本';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`prompt_version` IS '评分提示词版本';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`judge_provider_id` IS '实际执行评分的模型提供方 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`judge_model_id` IS '实际执行评分的模型 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`user_score` IS '用户输入质量得分，百分制扣分后结果';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`assistant_score` IS '模型回复质量得分，百分制扣分后结果';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`summary` IS '本轮评估摘要';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`major_issue_side` IS '主要问题侧：user_input、model_reply、both、none';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`result_json` IS '完整结构化评估结果 JSON';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`error_code` IS '评估失败或跳过时的错误码';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`error_message` IS '评估失败或跳过时的错误详情';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`time_started` IS '评估开始时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`time_finished` IS '评估结束时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`time_created` IS '记录创建时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval`.`time_updated` IS '记录更新时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON TABLE `tp_saved_plan_eval_item` IS '已保存计划的质量评估维度明细表';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`id` IS '评估明细主键';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`eval_id` IS '关联的评估主表 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`plan_id` IS '关联的已保存计划 ID';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`vho_feedback_no` IS '保存计划时填写的反馈号';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`subject` IS '评分主体：user_input 或 model_reply';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`dimension_code` IS '评分维度编码';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`dimension_name` IS '评分维度名称';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`max_deduction` IS '该维度最大可扣分';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`deducted_score` IS '该维度实际扣分';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`final_score` IS '该维度最终得分';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`reason` IS '该维度扣分或不扣分原因';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`evidence_json` IS '该维度证据片段 JSON 数组';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`position` IS '该主体下维度顺序';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`time_created` IS '记录创建时间戳（毫秒）';
--> statement-breakpoint
COMMENT ON COLUMN `tp_saved_plan_eval_item`.`time_updated` IS '记录更新时间戳（毫秒）';
