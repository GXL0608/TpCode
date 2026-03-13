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

        "loginInfo": {

            "userId": "admin",

            "userName": "系统管理员",

            "departmentId": "01",

            "departmentName": "研发部",

            "roleName": "总监",

            "teamId": "T001"

            // ... 更多用户信息

        },

        "feedbackData": {

            "list": [

                {

                    "feedbackId": "F20231024001",

                    "feedbackDes": "登录界面加载缓慢的问题...",

                    "customerName": "第一人民医院",

                    "feedbackTime": "2023-10-24 10:00:00",

                    "resolutionStatusName": "已解决"

                    // ... 更多反馈详情

                }

            ],

            "total": 125

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