import { createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"

/**
 * 检测是否为桌面设备
 * 结合屏幕宽度和设备类型判断，避免将高分辨率手机误判为桌面端
 *
 * 判断逻辑：
 * 1. 宽度 >= 1280px 且非触摸设备 -> 桌面端
 * 2. 宽度 >= 768px 且 < 1280px -> 需要检查是否为触摸设备
 *    - 非触摸设备（如平板电脑连接键盘鼠标）-> 桌面端
 *    - 触摸设备 -> 移动端
 * 3. 宽度 < 768px -> 移动端
 */
export function createIsDesktop() {
  const isWideScreen = createMediaQuery("(min-width: 1280px)")
  const isMediumScreen = createMediaQuery("(min-width: 768px) and (max-width: 1279px)")

  return createMemo(() => {
    // 宽屏且非触摸设备，肯定是桌面端
    if (isWideScreen()) {
      return !isTouchDevice()
    }

    // 中等宽度（768-1279px），需要检查是否为触摸设备
    if (isMediumScreen()) {
      return !isTouchDevice()
    }

    // 窄屏（< 768px），肯定是移动端
    return false
  })
}

/**
 * 检测是否为触摸设备
 */
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false

  // 检查是否支持触摸事件
  const hasTouchSupport =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-ignore - 兼容旧版浏览器
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)

  // 检查是否为移动设备 User Agent
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
  const hasCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false

  // 仅在移动 UA 或触摸 + 粗指针时视为移动设备，避免触屏笔记本被误判为移动端
  return isMobileUA || (hasTouchSupport && hasCoarsePointer)
}
