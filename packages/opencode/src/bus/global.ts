import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()

/** 中文注释：全局事件总线天然会承载大量 SSE 订阅，关闭默认 10 个监听器的误报阈值。 */
GlobalBus.setMaxListeners(0)
