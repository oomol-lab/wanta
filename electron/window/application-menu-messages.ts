import type { AppLocale } from "../app-locale.ts"

import { branding } from "../branding.ts"

export interface ApplicationMenuLabels {
  about: string
  closeWindow: string
  copy: string
  cut: string
  delete: string
  developer: string
  edit: string
  exit: string
  file: string
  focusComposer: string
  forceReload: string
  front: string
  help: string
  hide: string
  hideOthers: string
  minimize: string
  newChat: string
  paste: string
  pasteAndMatchStyle: string
  quit: string
  redo: string
  reload: string
  resetZoom: string
  searchTasks: string
  selectAll: string
  services: string
  settings: string
  showAll: string
  stopGeneration: string
  toggleDevTools: string
  toggleFullScreen: string
  toggleSidebar: string
  undo: string
  view: string
  window: string
  zoom: string
  zoomIn: string
  zoomOut: string
}

export const applicationMenuMessages: Record<AppLocale, ApplicationMenuLabels> = {
  "zh-CN": {
    about: `关于 ${branding.appName}`,
    closeWindow: "关闭窗口",
    copy: "复制",
    cut: "剪切",
    delete: "删除",
    developer: "开发",
    edit: "编辑",
    exit: "退出",
    file: "文件",
    focusComposer: "聚焦输入框",
    forceReload: "强制重新加载",
    front: "前置所有窗口",
    help: "帮助",
    hide: `隐藏 ${branding.appName}`,
    hideOthers: "隐藏其他",
    minimize: "最小化",
    newChat: "新对话",
    paste: "粘贴",
    pasteAndMatchStyle: "粘贴并匹配样式",
    quit: `退出 ${branding.appName}`,
    redo: "重做",
    reload: "重新加载窗口",
    resetZoom: "实际大小",
    searchTasks: "搜索任务",
    selectAll: "全选",
    services: "服务",
    settings: "设置…",
    showAll: "全部显示",
    stopGeneration: "停止生成",
    toggleDevTools: "切换开发者工具",
    toggleFullScreen: "切换全屏",
    toggleSidebar: "切换侧边栏",
    undo: "撤销",
    view: "视图",
    window: "窗口",
    zoom: "缩放",
    zoomIn: "放大",
    zoomOut: "缩小",
  },
  en: {
    about: `About ${branding.appName}`,
    closeWindow: "Close Window",
    copy: "Copy",
    cut: "Cut",
    delete: "Delete",
    developer: "Developer",
    edit: "Edit",
    exit: "Exit",
    file: "File",
    focusComposer: "Focus Composer",
    forceReload: "Force Reload",
    front: "Bring All to Front",
    help: "Help",
    hide: `Hide ${branding.appName}`,
    hideOthers: "Hide Others",
    minimize: "Minimize",
    newChat: "New Chat",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    quit: `Quit ${branding.appName}`,
    redo: "Redo",
    reload: "Reload Window",
    resetZoom: "Actual Size",
    searchTasks: "Search Tasks",
    selectAll: "Select All",
    services: "Services",
    settings: "Settings…",
    showAll: "Show All",
    stopGeneration: "Stop Generation",
    toggleDevTools: "Toggle Developer Tools",
    toggleFullScreen: "Toggle Full Screen",
    toggleSidebar: "Toggle Sidebar",
    undo: "Undo",
    view: "View",
    window: "Window",
    zoom: "Zoom",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
  },
}

export function applicationMenuLabels(locale: AppLocale): ApplicationMenuLabels {
  return applicationMenuMessages[locale]
}
