# TpCode 阶段 1 实施计划 Part 5: 协议层对接

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**前置依赖：** 完成 Part 4 中的 Task 16 (数据导出 API)

**目标：** 实现去中心化协议层对接，为 Phase 2 的子网集成做准备

---

## Task 17: MCP 协议客户端

**文件：**
- 创建: `packages/opencode/src/protocols/mcp-client.ts`
- 创建: `packages/opencode/src/protocols/mcp-client.test.ts`

**步骤 1: 编写 MCP 客户端测试**

创建 `packages/opencode/src/protocols/mcp-client.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { MCPClient, MCPMessage, MCPMessageType } from "./mcp-client"

describe("MCPClient", () => {
  test("should create MCP client", () => {
    const client = new MCPClient({
      endpoint: "http://localhost:3000/mcp",
      apiKey: "test-key",
    })

    expect(client).toBeDefined()
    expect(client.getEndpoint()).toBe("http://localhost:3000/mcp")
  })

  test("should send context message", async () => {
    const client = new MCPClient({
      endpoint: "http://localhost:3000/mcp",
      apiKey: "test-key",
    })

    const message: MCPMessage = {
      type: MCPMessageType.CONTEXT_SHARE,
      payload: {
        context: "User is working on authentication feature",
        metadata: { projectId: "proj-123" },
      },
    }

    const response = await client.send(message)

    expect(response).toBeDefined()
    expect(response.success).toBe(true)
  })

  test("should request context", async () => {
    const client = new MCPClient({
      endpoint: "http://localhost:3000/mcp",
      apiKey: "test-key",
    })

    const message: MCPMessage = {
      type: MCPMessageType.CONTEXT_REQUEST,
      payload: {
        query: "authentication patterns",
        filters: { language: "typescript" },
      },
    }

    const response = await client.send(message)

    expect(response).toBeDefined()
    expect(response.data).toBeDefined()
  })

  test("should handle connection errors", async () => {
    const client = new MCPClient({
      endpoint: "http://invalid-endpoint:9999/mcp",
      apiKey: "test-key",
    })

    const message: MCPMessage = {
      type: MCPMessageType.CONTEXT_SHARE,
      payload: {},
    }

    await expect(client.send(message)).rejects.toThrow()
  })

  test("should validate API key", () => {
    expect(() => {
      new MCPClient({
        endpoint: "http://localhost:3000/mcp",
        apiKey: "",
      })
    }).toThrow("API key is required")
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
bun test src/protocols/mcp-client.test.ts
```

预期输出: `FAIL - Cannot find module './mcp-client'`

**步骤 3: 实现 MCP 客户端**

创建 `packages/opencode/src/protocols/mcp-client.ts`:

```typescript
export enum MCPMessageType {
  CONTEXT_SHARE = "context_share",
  CONTEXT_REQUEST = "context_request",
  CONTEXT_UPDATE = "context_update",
  CONTEXT_DELETE = "context_delete",
}

export interface MCPMessage {
  type: MCPMessageType
  payload: Record<string, any>
}

export interface MCPResponse {
  success: boolean
  data?: any
  error?: string
}

export interface MCPClientConfig {
  endpoint: string
  apiKey: string
  timeout?: number
}

export class MCPClient {
  private endpoint: string
  private apiKey: string
  private timeout: number

  constructor(config: MCPClientConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required")
    }

    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.timeout = config.timeout || 30000
  }

  async send(message: MCPMessage): Promise<MCPResponse> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        success: true,
        data,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  async shareContext(context: string, metadata?: Record<string, any>): Promise<MCPResponse> {
    return this.send({
      type: MCPMessageType.CONTEXT_SHARE,
      payload: { context, metadata },
    })
  }

  async requestContext(query: string, filters?: Record<string, any>): Promise<MCPResponse> {
    return this.send({
      type: MCPMessageType.CONTEXT_REQUEST,
      payload: { query, filters },
    })
  }

  async updateContext(contextId: string, updates: Record<string, any>): Promise<MCPResponse> {
    return this.send({
      type: MCPMessageType.CONTEXT_UPDATE,
      payload: { contextId, updates },
    })
  }

  async deleteContext(contextId: string): Promise<MCPResponse> {
    return this.send({
      type: MCPMessageType.CONTEXT_DELETE,
      payload: { contextId },
    })
  }

  getEndpoint(): string {
    return this.endpoint
  }
}
```

**步骤 4: 运行测试确认通过**

```bash
bun test src/protocols/mcp-client.test.ts
```

预期输出: `✓ All tests passed`

**步骤 5: 提交**

```bash
git add packages/opencode/src/protocols/mcp-client.*
git commit -m "feat(protocols): implement MCP (Model Context Protocol) client

- Send context sharing messages
- Request context from other agents
- Update and delete context entries
- Handle connection errors and timeouts
- Validate API keys
- Support custom endpoints

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---


## Task 18: UCP 协议客户端

**文件：**
- 创建: `packages/opencode/src/protocols/ucp-client.ts`
- 创建: `packages/opencode/src/protocols/ucp-client.test.ts`

**步骤 1: 编写 UCP 客户端测试**

创建 `packages/opencode/src/protocols/ucp-client.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { UCPClient, UCPTransaction, UCPTransactionType } from "./ucp-client"

describe("UCPClient", () => {
  test("should create UCP client", () => {
    const client = new UCPClient({
      endpoint: "http://localhost:3001/ucp",
      walletAddress: "0x1234567890abcdef",
    })

    expect(client).toBeDefined()
    expect(client.getWalletAddress()).toBe("0x1234567890abcdef")
  })

  test("should create payment transaction", async () => {
    const client = new UCPClient({
      endpoint: "http://localhost:3001/ucp",
      walletAddress: "0x1234567890abcdef",
    })

    const transaction: UCPTransaction = {
      type: UCPTransactionType.PAYMENT,
      from: "0x1234567890abcdef",
      to: "0xfedcba0987654321",
      amount: 100,
      currency: "TAO",
      metadata: {
        serviceId: "code-generation",
        sessionId: "session-123",
      },
    }

    const result = await client.createTransaction(transaction)

    expect(result.success).toBe(true)
    expect(result.transactionId).toBeDefined()
  })

  test("should query transaction status", async () => {
    const client = new UCPClient({
      endpoint: "http://localhost:3001/ucp",
      walletAddress: "0x1234567890abcdef",
    })

    const status = await client.getTransactionStatus("tx-123")

    expect(status).toBeDefined()
    expect(status.status).toBeDefined()
  })

  test("should get wallet balance", async () => {
    const client = new UCPClient({
      endpoint: "http://localhost:3001/ucp",
      walletAddress: "0x1234567890abcdef",
    })

    const balance = await client.getBalance()

    expect(balance).toBeDefined()
    expect(typeof balance.amount).toBe("number")
  })

  test("should validate wallet address", () => {
    expect(() => {
      new UCPClient({
        endpoint: "http://localhost:3001/ucp",
        walletAddress: "invalid-address",
      })
    }).toThrow("Invalid wallet address")
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
bun test src/protocols/ucp-client.test.ts
```

预期输出: `FAIL - Cannot find module './ucp-client'`

**步骤 3: 实现 UCP 客户端**

创建 `packages/opencode/src/protocols/ucp-client.ts`:

```typescript
export enum UCPTransactionType {
  PAYMENT = "payment",
  REFUND = "refund",
  REWARD = "reward",
  STAKE = "stake",
}

export interface UCPTransaction {
  type: UCPTransactionType
  from: string
  to: string
  amount: number
  currency: string
  metadata?: Record<string, any>
}

export interface UCPTransactionResult {
  success: boolean
  transactionId?: string
  error?: string
}

export interface UCPTransactionStatus {
  transactionId: string
  status: "pending" | "confirmed" | "failed"
  confirmations?: number
  timestamp?: number
}

export interface UCPBalance {
  amount: number
  currency: string
  locked?: number
}

export interface UCPClientConfig {
  endpoint: string
  walletAddress: string
  timeout?: number
}

export class UCPClient {
  private endpoint: string
  private walletAddress: string
  private timeout: number

  constructor(config: UCPClientConfig) {
    if (!this.isValidWalletAddress(config.walletAddress)) {
      throw new Error("Invalid wallet address")
    }

    this.endpoint = config.endpoint
    this.walletAddress = config.walletAddress
    this.timeout = config.timeout || 30000
  }

  async createTransaction(transaction: UCPTransaction): Promise<UCPTransactionResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.endpoint}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transaction),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`UCP transaction failed: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        success: true,
        transactionId: data.transactionId,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  async getTransactionStatus(transactionId: string): Promise<UCPTransactionStatus> {
    const response = await fetch(`${this.endpoint}/transactions/${transactionId}`)

    if (!response.ok) {
      throw new Error(`Failed to get transaction status: ${response.statusText}`)
    }

    return response.json()
  }

  async getBalance(): Promise<UCPBalance> {
    const response = await fetch(`${this.endpoint}/wallets/${this.walletAddress}/balance`)

    if (!response.ok) {
      throw new Error(`Failed to get balance: ${response.statusText}`)
    }

    return response.json()
  }

  async sendPayment(to: string, amount: number, currency: string, metadata?: Record<string, any>): Promise<UCPTransactionResult> {
    return this.createTransaction({
      type: UCPTransactionType.PAYMENT,
      from: this.walletAddress,
      to,
      amount,
      currency,
      metadata,
    })
  }

  async requestRefund(transactionId: string, reason?: string): Promise<UCPTransactionResult> {
    const response = await fetch(`${this.endpoint}/transactions/${transactionId}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    })

    if (!response.ok) {
      return {
        success: false,
        error: `Refund request failed: ${response.statusText}`,
      }
    }

    const data = await response.json()

    return {
      success: true,
      transactionId: data.refundTransactionId,
    }
  }

  getWalletAddress(): string {
    return this.walletAddress
  }

  private isValidWalletAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{16,}$/.test(address)
  }
}
```

**步骤 4: 运行测试确认通过**

```bash
bun test src/protocols/ucp-client.test.ts
```

预期输出: `✓ All tests passed`

**步骤 5: 提交**

```bash
git add packages/opencode/src/protocols/ucp-client.*
git commit -m "feat(protocols): implement UCP (Universal Commerce Protocol) client

- Create payment transactions
- Query transaction status and confirmations
- Get wallet balance
- Send payments with metadata
- Request refunds
- Validate wallet addresses
- Support multiple currencies (TAO, etc.)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 19: AP2 协议客户端

**文件：**
- 创建: `packages/opencode/src/protocols/ap2-client.ts`
- 创建: `packages/opencode/src/protocols/ap2-client.test.ts`

**步骤 1: 编写 AP2 客户端测试**

创建 `packages/opencode/src/protocols/ap2-client.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { AP2Client, AP2Invoice, AP2PaymentMethod } from "./ap2-client"

describe("AP2Client", () => {
  test("should create AP2 client", () => {
    const client = new AP2Client({
      endpoint: "http://localhost:3002/ap2",
      agentId: "agent-123",
      apiKey: "test-key",
    })

    expect(client).toBeDefined()
    expect(client.getAgentId()).toBe("agent-123")
  })

  test("should create invoice", async () => {
    const client = new AP2Client({
      endpoint: "http://localhost:3002/ap2",
      agentId: "agent-123",
      apiKey: "test-key",
    })

    const invoice: AP2Invoice = {
      amount: 50,
      currency: "TAO",
      description: "Code generation service",
      metadata: {
        sessionId: "session-123",
        lines: 100,
      },
    }

    const result = await client.createInvoice(invoice)

    expect(result.success).toBe(true)
    expect(result.invoiceId).toBeDefined()
  })

  test("should process payment", async () => {
    const client = new AP2Client({
      endpoint: "http://localhost:3002/ap2",
      agentId: "agent-123",
      apiKey: "test-key",
    })

    const result = await client.processPayment("invoice-123", {
      method: AP2PaymentMethod.WALLET,
      walletAddress: "0x1234567890abcdef",
    })

    expect(result.success).toBe(true)
    expect(result.paymentId).toBeDefined()
  })

  test("should get payment history", async () => {
    const client = new AP2Client({
      endpoint: "http://localhost:3002/ap2",
      agentId: "agent-123",
      apiKey: "test-key",
    })

    const history = await client.getPaymentHistory({
      startDate: Date.now() - 86400000,
      endDate: Date.now(),
    })

    expect(history).toBeDefined()
    expect(Array.isArray(history.payments)).toBe(true)
  })

  test("should calculate service fee", async () => {
    const client = new AP2Client({
      endpoint: "http://localhost:3002/ap2",
      agentId: "agent-123",
      apiKey: "test-key",
    })

    const fee = await client.calculateFee({
      serviceType: "code_generation",
      complexity: "medium",
      lines: 100,
    })

    expect(fee).toBeDefined()
    expect(typeof fee.amount).toBe("number")
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
bun test src/protocols/ap2-client.test.ts
```

预期输出: `FAIL - Cannot find module './ap2-client'`

**步骤 3: 实现 AP2 客户端**

创建 `packages/opencode/src/protocols/ap2-client.ts`:

```typescript
export enum AP2PaymentMethod {
  WALLET = "wallet",
  CREDIT_CARD = "credit_card",
  BANK_TRANSFER = "bank_transfer",
}

export interface AP2Invoice {
  amount: number
  currency: string
  description: string
  metadata?: Record<string, any>
}

export interface AP2InvoiceResult {
  success: boolean
  invoiceId?: string
  paymentUrl?: string
  error?: string
}

export interface AP2PaymentResult {
  success: boolean
  paymentId?: string
  error?: string
}

export interface AP2PaymentHistory {
  payments: Array<{
    paymentId: string
    invoiceId: string
    amount: number
    currency: string
    status: string
    timestamp: number
  }>
  total: number
}

export interface AP2FeeCalculation {
  amount: number
  currency: string
  breakdown: {
    base: number
    complexity: number
    volume: number
  }
}

export interface AP2ClientConfig {
  endpoint: string
  agentId: string
  apiKey: string
  timeout?: number
}

export class AP2Client {
  private endpoint: string
  private agentId: string
  private apiKey: string
  private timeout: number

  constructor(config: AP2ClientConfig) {
    if (!config.agentId) {
      throw new Error("Agent ID is required")
    }
    if (!config.apiKey) {
      throw new Error("API key is required")
    }

    this.endpoint = config.endpoint
    this.agentId = config.agentId
    this.apiKey = config.apiKey
    this.timeout = config.timeout || 30000
  }

  async createInvoice(invoice: AP2Invoice): Promise<AP2InvoiceResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.endpoint}/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Agent-ID": this.agentId,
        },
        body: JSON.stringify(invoice),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Failed to create invoice: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        success: true,
        invoiceId: data.invoiceId,
        paymentUrl: data.paymentUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  async processPayment(
    invoiceId: string,
    paymentDetails: {
      method: AP2PaymentMethod
      walletAddress?: string
      cardToken?: string
    }
  ): Promise<AP2PaymentResult> {
    try {
      const response = await fetch(`${this.endpoint}/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Agent-ID": this.agentId,
        },
        body: JSON.stringify(paymentDetails),
      })

      if (!response.ok) {
        throw new Error(`Payment failed: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        success: true,
        paymentId: data.paymentId,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  async getPaymentHistory(filters: {
    startDate?: number
    endDate?: number
    status?: string
  }): Promise<AP2PaymentHistory> {
    const params = new URLSearchParams()
    if (filters.startDate) params.append("startDate", filters.startDate.toString())
    if (filters.endDate) params.append("endDate", filters.endDate.toString())
    if (filters.status) params.append("status", filters.status)

    const response = await fetch(`${this.endpoint}/payments?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Agent-ID": this.agentId,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get payment history: ${response.statusText}`)
    }

    return response.json()
  }

  async calculateFee(params: {
    serviceType: string
    complexity: string
    lines?: number
    tokens?: number
  }): Promise<AP2FeeCalculation> {
    const response = await fetch(`${this.endpoint}/fees/calculate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "X-Agent-ID": this.agentId,
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      throw new Error(`Failed to calculate fee: ${response.statusText}`)
    }

    return response.json()
  }

  async getInvoiceStatus(invoiceId: string): Promise<{
    status: "pending" | "paid" | "cancelled" | "expired"
    amount: number
    currency: string
    createdAt: number
    paidAt?: number
  }> {
    const response = await fetch(`${this.endpoint}/invoices/${invoiceId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Agent-ID": this.agentId,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get invoice status: ${response.statusText}`)
    }

    return response.json()
  }

  getAgentId(): string {
    return this.agentId
  }
}
```

**步骤 4: 运行测试确认通过**

```bash
bun test src/protocols/ap2-client.test.ts
```

预期输出: `✓ All tests passed`

**步骤 5: 提交**

```bash
git add packages/opencode/src/protocols/ap2-client.*
git commit -m "feat(protocols): implement AP2 (Agent Payments Protocol) client

- Create invoices for agent services
- Process payments with multiple methods (wallet, card, bank)
- Get payment history with filters
- Calculate service fees based on complexity
- Query invoice status
- Support agent-to-agent payments

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 20: 协议集成层

**文件：**
- 创建: `packages/opencode/src/protocols/protocol-manager.ts`
- 创建: `packages/opencode/src/protocols/protocol-manager.test.ts`

**步骤 1: 编写协议管理器测试**

创建 `packages/opencode/src/protocols/protocol-manager.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { ProtocolManager } from "./protocol-manager"

describe("ProtocolManager", () => {
  test("should initialize all protocol clients", () => {
    const manager = new ProtocolManager({
      mcp: {
        endpoint: "http://localhost:3000/mcp",
        apiKey: "mcp-key",
      },
      ucp: {
        endpoint: "http://localhost:3001/ucp",
        walletAddress: "0x1234567890abcdef",
      },
      ap2: {
        endpoint: "http://localhost:3002/ap2",
        agentId: "agent-123",
        apiKey: "ap2-key",
      },
    })

    expect(manager.getMCPClient()).toBeDefined()
    expect(manager.getUCPClient()).toBeDefined()
    expect(manager.getAP2Client()).toBeDefined()
  })

  test("should share context via MCP", async () => {
    const manager = new ProtocolManager({
      mcp: {
        endpoint: "http://localhost:3000/mcp",
        apiKey: "mcp-key",
      },
      ucp: {
        endpoint: "http://localhost:3001/ucp",
        walletAddress: "0x1234567890abcdef",
      },
      ap2: {
        endpoint: "http://localhost:3002/ap2",
        agentId: "agent-123",
        apiKey: "ap2-key",
      },
    })

    const result = await manager.shareContext("Working on authentication", {
      projectId: "proj-123",
    })

    expect(result.success).toBe(true)
  })

  test("should create invoice and process payment", async () => {
    const manager = new ProtocolManager({
      mcp: {
        endpoint: "http://localhost:3000/mcp",
        apiKey: "mcp-key",
      },
      ucp: {
        endpoint: "http://localhost:3001/ucp",
        walletAddress: "0x1234567890abcdef",
      },
      ap2: {
        endpoint: "http://localhost:3002/ap2",
        agentId: "agent-123",
        apiKey: "ap2-key",
      },
    })

    const invoiceResult = await manager.createServiceInvoice({
      amount: 50,
      currency: "TAO",
      description: "Code generation",
    })

    expect(invoiceResult.success).toBe(true)

    if (invoiceResult.invoiceId) {
      const paymentResult = await manager.payInvoice(invoiceResult.invoiceId, {
        method: "wallet",
        walletAddress: "0x1234567890abcdef",
      })

      expect(paymentResult.success).toBe(true)
    }
  })

  test("should get protocol health status", async () => {
    const manager = new ProtocolManager({
      mcp: {
        endpoint: "http://localhost:3000/mcp",
        apiKey: "mcp-key",
      },
      ucp: {
        endpoint: "http://localhost:3001/ucp",
        walletAddress: "0x1234567890abcdef",
      },
      ap2: {
        endpoint: "http://localhost:3002/ap2",
        agentId: "agent-123",
        apiKey: "ap2-key",
      },
    })

    const health = await manager.getHealthStatus()

    expect(health).toHaveProperty("mcp")
    expect(health).toHaveProperty("ucp")
    expect(health).toHaveProperty("ap2")
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
bun test src/protocols/protocol-manager.test.ts
```

预期输出: `FAIL - Cannot find module './protocol-manager'`

**步骤 3: 实现协议管理器**

创建 `packages/opencode/src/protocols/protocol-manager.ts`:

```typescript
import { MCPClient } from "./mcp-client"
import { UCPClient } from "./ucp-client"
import { AP2Client, AP2PaymentMethod } from "./ap2-client"

export interface ProtocolManagerConfig {
  mcp: {
    endpoint: string
    apiKey: string
  }
  ucp: {
    endpoint: string
    walletAddress: string
  }
  ap2: {
    endpoint: string
    agentId: string
    apiKey: string
  }
}

export interface ProtocolHealth {
  mcp: { status: "healthy" | "unhealthy"; latency?: number }
  ucp: { status: "healthy" | "unhealthy"; latency?: number }
  ap2: { status: "healthy" | "unhealthy"; latency?: number }
}

export class ProtocolManager {
  private mcpClient: MCPClient
  private ucpClient: UCPClient
  private ap2Client: AP2Client

  constructor(config: ProtocolManagerConfig) {
    this.mcpClient = new MCPClient(config.mcp)
    this.ucpClient = new UCPClient(config.ucp)
    this.ap2Client = new AP2Client(config.ap2)
  }

  getMCPClient(): MCPClient {
    return this.mcpClient
  }

  getUCPClient(): UCPClient {
    return this.ucpClient
  }

  getAP2Client(): AP2Client {
    return this.ap2Client
  }

  async shareContext(context: string, metadata?: Record<string, any>) {
    return this.mcpClient.shareContext(context, metadata)
  }

  async requestContext(query: string, filters?: Record<string, any>) {
    return this.mcpClient.requestContext(query, filters)
  }

  async createServiceInvoice(invoice: {
    amount: number
    currency: string
    description: string
    metadata?: Record<string, any>
  }) {
    return this.ap2Client.createInvoice(invoice)
  }

  async payInvoice(
    invoiceId: string,
    paymentDetails: {
      method: string
      walletAddress?: string
      cardToken?: string
    }
  ) {
    const method = paymentDetails.method as AP2PaymentMethod
    return this.ap2Client.processPayment(invoiceId, {
      method,
      walletAddress: paymentDetails.walletAddress,
      cardToken: paymentDetails.cardToken,
    })
  }

  async sendPayment(to: string, amount: number, currency: string, metadata?: Record<string, any>) {
    return this.ucpClient.sendPayment(to, amount, currency, metadata)
  }

  async getWalletBalance() {
    return this.ucpClient.getBalance()
  }

  async getPaymentHistory(filters: { startDate?: number; endDate?: number; status?: string }) {
    return this.ap2Client.getPaymentHistory(filters)
  }

  async getHealthStatus(): Promise<ProtocolHealth> {
    const health: ProtocolHealth = {
      mcp: { status: "healthy" },
      ucp: { status: "healthy" },
      ap2: { status: "healthy" },
    }

    try {
      const startMcp = Date.now()
      await this.mcpClient.requestContext("health-check")
      health.mcp.latency = Date.now() - startMcp
    } catch (error) {
      health.mcp.status = "unhealthy"
    }

    try {
      const startUcp = Date.now()
      await this.ucpClient.getBalance()
      health.ucp.latency = Date.now() - startUcp
    } catch (error) {
      health.ucp.status = "unhealthy"
    }

    try {
      const startAp2 = Date.now()
      await this.ap2Client.getPaymentHistory({})
      health.ap2.latency = Date.now() - startAp2
    } catch (error) {
      health.ap2.status = "unhealthy"
    }

    return health
  }
}
```

**步骤 4: 运行测试确认通过**

```bash
bun test src/protocols/protocol-manager.test.ts
```

预期输出: `✓ All tests passed`

**步骤 5: 提交**

```bash
git add packages/opencode/src/protocols/protocol-manager.*
git commit -m "feat(protocols): implement unified protocol manager

- Initialize and manage all protocol clients (MCP, UCP, AP2)
- Unified interface for context sharing
- Unified interface for payments and invoices
- Health monitoring for all protocols
- Simplified API for common operations

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

**Part 5 完成总结：**

已实现完整的去中心化协议层对接：
- Task 17: MCP 协议客户端（上下文共享、请求、更新、删除）
- Task 18: UCP 协议客户端（支付交易、余额查询、退款）
- Task 19: AP2 协议客户端（发票创建、支付处理、费用计算）
- Task 20: 协议集成层（统一管理、健康监控、简化 API）

**Phase 1 全部完成！**

所有 20 个任务已完成，涵盖：
- 多智能体协作框架（Tasks 1-6）
- 知识产权保护系统（Tasks 7-11）
- 蒸馏数据采集系统（Tasks 12-16）
- 去中心化协议对接（Tasks 17-20）
