# 组合接口文档：获取登录信息及反馈任务列表

此接口用于一次性获取指定用户的背景信息（登录信息）及其关联的反馈任务列表数据。支持分页查询及多种过滤条件。

## 1. 接口信息

- **接口地址**: `http://123.57.5.73:9527/prod-api/feedbackTask/umGetLoginAndFeedbackList`
- **请求方式**: `POST`
- **身份验证**: **无需 Token** (已配置 `@SaIgnore`)
- **内容类型**: `application/json`

## 2. 请求参数 (Request Body)

请求体为 

FeedbackDTO 对象，主要字段如下：



### 核心参数

| 字段名     | 类型   | 必选   | 说明                                          |
| :--------- | :----- | :----- | :-------------------------------------------- |
| **userId** | String | **是** | 用户编码 (用于获取登录信息及作为默认查询条件) |

### 查询过滤参数 (可选)

| 字段名           | 类型   | 说明                                                     |
| :--------------- | :----- | :------------------------------------------------------- |
| **feedbackId**   | String | 反馈编码。支持输入多个，用逗号 `,`、空格或顿号 `、` 分隔 |
| **planId**       | String | 关联计划 ID                                              |
| **feedbackDes**  | String | 反馈内容描述。支持**模糊搜索**                           |
| regionId         | String | 区域 ID。支持逗号分隔多个                                |
| customerId       | String | 客户编码。支持逗号分隔多个                               |
| productId        | String | 产品编码。支持逗号分隔多个                               |
| teamId           | String | 产品团队 ID。支持逗号分隔多个                            |
| resolutionStatus | String | 解决状态。支持逗号分隔多个                               |
| planStartDate    | String | 反馈开始日期 (yyyy-MM-dd)                                |
| planEndDate      | String | 反馈结束日期 (yyyy-MM-dd)                                |

### 解决状态：
CASE
                WHEN RESOLUTION_STATUS = '0' THEN '未解决'
                WHEN RESOLUTION_STATUS = '1' THEN '已解决'
                WHEN RESOLUTION_STATUS = '9' THEN '未标记'
                END AS resolutionStatusName,
### 分页参数 (可选)

| 字段名       | 类型    | 说明                 |
| :----------- | :------ | :------------------- |
| **pageNum**  | Integer | 当前页码 (从 1 开始) |
| **pageSize** | Integer | 每页条数             |

## 3. 响应参数 (Response Body)

返回结果采用统一的 

Result 包装格式。



### 成功响应示例

```
json
{
    "code": 200,
    "message": "查询成功",
    "content": {
        "feedbackData": {
            "list": [
                {
                    "regionId": null,
                    "rework": null,
                    "fmCount": "0",
                    "feedbackId": "F10063297",
                    "customerId": "101118",
                    "customerName": "唐山市丰润区第二人民医院",
                    "contractId": "L202310120740",
                    "contractName": "基础服务",
                    "productId": "P064",
                    "productName": "院感管理系统",
                    "moduleId": "M1157",
                    "moduleName": "院感上报卡",
                    "functionId": "F11797",
                    "functionName": "多重耐药菌感染上报卡",
                    "tasktypeId": "00",
                    "tasktypeName": "反馈问题",
                    "tasktypeKzId": "0000",
                    "tasktypeKzName": "需求反馈",
                    "feedbackDes": "微生物信息录入部分选项设置为非必填",
                    "feedbackFile": "上传",
                    "userId": "15841622010",
                    "userName": "邹卓衡",
                    "feedbackTime": "2025-11-11 17:44:52",
                    "feedbackDept": "院感科",
                    "feedbackCusUser": "院感科主任",
                    "feedbackPhone": "无",
                    "resolutionStatus": "1",
                    "resolutionStatusName": "已解决",
                    "testResult": "上传",
                    "taskId": "T10128210",
                    "rdUserId": "15841622010",
                    "rdUserName": "邹卓衡",
                    "rdPlanEndDate": "2025-11-11",
                    "rdPlanStartDate": null,
                    "rdTaskStatus": "已完成",
                    "rdPackage": "未发包",
                    "stageId": "ST11320",
                    "planId": null,
                    "requireDate": null,
                    "priorityLevel": "0",
                    "priorityLevelName": null,
                    "urgentMessage": null,
                    "receiveUserId": null,
                    "isBlock": "0",
                    "isBlockName": "否",
                    "blockReason": null,
                    "middleGroundAuditId": "1",
                    "middleGroundAuditName": "正常",
                    "middleGroundBz": null,
                    "middleGroundUserId": null,
                    "middleGroundUserName": null,
                    "middleGroundDate": null,
                    "existFile": "开发中",
                    "onlineFile": null,
                    "useFile": null,
                    "goodFile": null,
                    "manyFile": null,
                    "moneyFile": null,
                    "onlineRemark": null,
                    "useRemark": null,
                    "sameDay": null,
                    "defaultExistDate": "2025-11-11",
                    "defaultOnlineDate": "2025-11-12",
                    "defaultUseDate": "2025-11-13",
                    "realOnlineDate": null,
                    "realUseDate": null,
                    "onlineData": null,
                    "useData": null,
                    "manyData": null,
                    "reworkTotal": 0,
                    "reworkReason": null,
                    "onlinePdfFile": null,
                    "usePdfFile": null,
                    "manyPdfFile": null,
                    "goodPdfFile": null,
                    "moneyPdfFile": null,
                    "feedColor": "green",
                    "isTableData": "未填写",
                    "demandTypeId": "1",
                    "demandTypeName": "正常需求",
                    "demandTypeIds": null,
                    "targetStartDate": "2023-12-18",
                    "targetEndDate": "2024-01-31",
                    "targetDesc": "院感问题",
                    "contractType": null,
                    "isImportant": "1",
                    "taskEndTime": "2025-11-11 17:45:35",
                    "stageTargetId": "TS1",
                    "stageTargetMc": "研发任务",
                    "confirmCustomerStatus": null,
                    "confirmUserId": null,
                    "confirmName": null,
                    "userEvaluationLevel": null,
                    "feedbackEvaluationLevel": null,
                    "evalUserScore": null,
                    "evalScore": null,
                    "evaluationContent": null,
                    "taskEvalId": null,
                    "feedbackPerson": null,
                    "evaluator": null,
                    "evaluationTime": null,
                    "evaluatorName": null,
                    "confirmTime": null,
                    "urgentStatus": null,
                    "jcfzUserId": null,
                    "evalutionType": null,
                    "ztfzUserId": null,
                    "yfUserId": null,
                    "ssUserId": null,
                    "reportId": null,
                    "responsibleUserId": null,
                    "responsibleUserName": null,
                    "customerFeedbackId": null,
                    "menuId": null,
                    "siteCustomerScore": null,
                    "siteCustomerComment": "院感科主任",
                    "engineerScore": null,
                    "engineerComment": "邹卓衡",
                    "customerManagerScore": null,
                    "customerManagerComment": "范立红",
                    "rdScore": null,
                    "rdComment": "邹卓衡",
                    "active": null,
                    "userType": null,
                    "yfUserIdList": null,
                    "responseTime": "0分钟",
                    "rdTime": "15分钟",
                    "engineerResponseTime": "-14分钟",
                    "isAiPlan": null,
                    "isExist": "无",
                    "isOnline": "无",
                    "isUse": "无",
                    "isMany": "无",
                    "isGood": "无",
                    "isMoney": "无"
                },
                {
                    "regionId": null,
                    "rework": null,
                    "fmCount": "0",
                    "feedbackId": "F10063790",
                    "customerId": "101118",
                    "customerName": "唐山市丰润区第二人民医院",
                    "contractId": "L202310120740",
                    "contractName": "基础服务",
                    "productId": "P064",
                    "productName": "院感管理系统",
                    "moduleId": "M1157",
                    "moduleName": "院感上报卡",
                    "functionId": "F11763",
                    "functionName": "院感上报卡",
                    "tasktypeId": "00",
                    "tasktypeName": "反馈问题",
                    "tasktypeKzId": "0000",
                    "tasktypeKzName": "需求反馈",
                    "feedbackDes": "院感问题整改",
                    "feedbackFile": "上传",
                    "userId": "15841622010",
                    "userName": "邹卓衡",
                    "feedbackTime": "2025-11-21 15:54:18",
                    "feedbackDept": "院感科",
                    "feedbackCusUser": "院感科主任",
                    "feedbackPhone": "无",
                    "resolutionStatus": "1",
                    "resolutionStatusName": "已解决",
                    "testResult": "上传",
                    "taskId": "T10128609",
                    "rdUserId": "15841622010",
                    "rdUserName": "邹卓衡",
                    "rdPlanEndDate": "2025-11-21",
                    "rdPlanStartDate": null,
                    "rdTaskStatus": "已完成",
                    "rdPackage": "未发包",
                    "stageId": "ST11320",
                    "planId": null,
                    "requireDate": null,
                    "priorityLevel": "0",
                    "priorityLevelName": null,
                    "urgentMessage": null,
                    "receiveUserId": null,
                    "isBlock": "0",
                    "isBlockName": "否",
                    "blockReason": null,
                    "middleGroundAuditId": "1",
                    "middleGroundAuditName": "正常",
                    "middleGroundBz": null,
                    "middleGroundUserId": null,
                    "middleGroundUserName": null,
                    "middleGroundDate": null,
                    "existFile": "已处理",
                    "onlineFile": null,
                    "useFile": null,
                    "goodFile": null,
                    "manyFile": null,
                    "moneyFile": null,
                    "onlineRemark": null,
                    "useRemark": null,
                    "sameDay": null,
                    "defaultExistDate": "2025-11-21",
                    "defaultOnlineDate": "2025-11-22",
                    "defaultUseDate": "2025-11-23",
                    "realOnlineDate": null,
                    "realUseDate": null,
                    "onlineData": null,
                    "useData": null,
                    "manyData": null,
                    "reworkTotal": 0,
                    "reworkReason": null,
                    "onlinePdfFile": null,
                    "usePdfFile": null,
                    "manyPdfFile": null,
                    "goodPdfFile": null,
                    "moneyPdfFile": null,
                    "feedColor": "green",
                    "isTableData": "未填写",
                    "demandTypeId": "1",
                    "demandTypeName": "正常需求",
                    "demandTypeIds": null,
                    "targetStartDate": "2023-12-18",
                    "targetEndDate": "2024-01-31",
                    "targetDesc": "院感问题",
                    "contractType": null,
                    "isImportant": "1",
                    "taskEndTime": "2025-11-21 22:19:42",
                    "stageTargetId": "TS1",
                    "stageTargetMc": "研发任务",
                    "confirmCustomerStatus": null,
                    "confirmUserId": null,
                    "confirmName": null,
                    "userEvaluationLevel": null,
                    "feedbackEvaluationLevel": null,
                    "evalUserScore": null,
                    "evalScore": null,
                    "evaluationContent": null,
                    "taskEvalId": null,
                    "feedbackPerson": null,
                    "evaluator": null,
                    "evaluationTime": null,
                    "evaluatorName": null,
                    "confirmTime": null,
                    "urgentStatus": null,
                    "jcfzUserId": null,
                    "evalutionType": null,
                    "ztfzUserId": null,
                    "yfUserId": null,
                    "ssUserId": null,
                    "reportId": null,
                    "responsibleUserId": null,
                    "responsibleUserName": null,
                    "customerFeedbackId": null,
                    "menuId": null,
                    "siteCustomerScore": null,
                    "siteCustomerComment": "院感科主任",
                    "engineerScore": null,
                    "engineerComment": "邹卓衡",
                    "customerManagerScore": null,
                    "customerManagerComment": "范立红",
                    "rdScore": null,
                    "rdComment": "邹卓衡",
                    "active": null,
                    "userType": null,
                    "yfUserIdList": null,
                    "responseTime": "0分钟",
                    "rdTime": "2小时5分钟",
                    "engineerResponseTime": "17天15小时38分钟",
                    "isAiPlan": null,
                    "isExist": "无",
                    "isOnline": "无",
                    "isUse": "无",
                    "isMany": "无",
                    "isGood": "无",
                    "isMoney": "无"
                }
            ],
            "total": 16,
            "todayTaskSl": null,
            "todayFeedSl": null,
            "totalTaskSl": null,
            "totalFeedSl": null,
            "fwBugCount": 0,
            "fwXqCount": 0,
            "htBugCount": 0,
            "htXqCount": 0,
            "fwBugTotalCount": 0,
            "fwXqTotalCount": 0,
            "htBugTotalCount": 0,
            "htXqTotalCount": 0,
            "totalReworkTotal": 0,
            "stats": null
        },
        "loginInfo": {
            "userId": "15841622010",
            "userName": "邹卓衡",
            "departmentId": "01",
            "postId": "P010",
            "teamId": "TEAM9",
            "customerId": "101068",
            "postName": "研发",
            "departmentName": "研发中心"
        }
    }
}
```

### 参数说明 (content 内部)

- **loginInfo**: 该用户的个人及组织架构详细信息。

- feedbackData

  :

  - 如果传入了分页参数，返回包含 `list` (数据列表) 和 `total` (总记录数) 的对象。
  - 如果未传分页参数，`feedbackData` 直接为反馈数据数组。

## 4. 异常响应

- **401**: 虽然已豁免 Token，但若内部逻辑出现异常可能返回。

- **500**: 系统内部错误，详见 `message` 字段。

- Fail (code!=200)

  : 例如

   

  userId

   

  为空时会返回

   

  ```
  userId 不能为空
  ```

  。