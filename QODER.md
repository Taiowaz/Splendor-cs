# Splendor CS · 项目约定

## Git 提交规范
**每个逻辑改动，一次提交。**

- "逻辑改动" = 一个特性 / 一次 bug 修复 / 一处完整的样式调整 / 一批相关素材。
- 允许（且鼓励）攒一下再提交：一段迭代内可以先做多个微调，到一个自然停顿点时把它们整理成 1-N 个原子提交。
- 不要一个 CSS 值改一次就 commit，也不要一整天的工作压成 1 个巨型 commit。
- 提交前跑 `git status` / `git diff` 确认分组合理，避免误带无关文件。
- 提交信息用中文或 `<type>: <摘要>` 前缀（feat / fix / style / chore / assets / docs）。

## 分支
- 主干 `master`。项目规模小，直接在主干上原子提交即可。
- 除非用户明确要求，不推远端、不 rebase、不 amend 已提交的 commit。

## 预览与工作流
- `client/public/card-preview.html` 是独立样例页，Vite 会把 `public/*` 拷到 `dist/`。
- 静态预览改动同步方式：`cp client/public/... client/dist/...`，不用重新构建。
