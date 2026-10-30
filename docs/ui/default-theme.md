# 默认主题

## 当前策略

- 应用首次启动且本地没有 `zcode-theme` 持久化值时，默认主题为 `dark`。
- 一旦用户主动切换主题，后续仍然优先读取本地保存值，不会被默认值覆盖。
- 桌面 HTML 启动壳在 React 接管前只读取 `zcode-theme`：`light` / `zai-light` 使用浅色，`dark` / `zai-dark` 使用深色，`system` 跟随系统；缺失、空值或无法读取时默认深色。未知非空值沿用 renderer 的浅色和无 Zai 主题类回退，不修改持久化值。
- 启动壳背景和 Logo 跟随应用主题。共享样式加载前的背景与 Zai Light / Dark 的 `--color-background` 一致，加载后继续使用该主题 token；减少动态效果时使用对应主题的静态 Logo。
- 启动壳只投影已有主题偏好，不写入存储、不改变原生窗口主题；更新状态窗口继续跳过启动壳。开发服务器和生产构建均从同一品牌资源取得 Logo。

## 验收场景

- 浅色系统搭配已保存的深色应用主题，以及深色系统搭配已保存的浅色应用主题，从 HTML 启动壳到 React 启动页保持应用主题。
- 无保存值、空值或存储不可读时默认深色；`system` 跟随系统；历史 `light` / `dark` 值仍可用。未知非空值与 renderer 的现有回退一致。
- 静态和动态 Logo 均与启动壳背景匹配，开发服务器与生产构建的图像可以实际解码。
- 启动壳移除后，现有应用主题同步、原生窗口材质、更新状态窗口和主界面启动流程保持原有时序。

## 实现位置

- Zustand store 默认值：`packages/ui/src/store/index.ts`
- 旧 `useTheme()` hook 兜底值：`packages/ui/src/useTheme.ts`
