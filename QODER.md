# Splendor CS · 项目约定

## Git 提交规范
**每改动一个点，提交一次。**

- 一次 commit = 一个逻辑改动（一个特性 / 一个 bug 修复 / 一次样式微调 / 一处素材替换）。
- 不要把多个不相关的改动混进同一个 commit。
- 提交前跑 `git status` 确认只暂存了本次改动，避免误带其他。
- 提交信息用中文或 `<type>: <摘要>` 前缀（feat / fix / style / chore / assets / docs）。

## 分支
- 主干 `master`。项目规模小，直接在主干上原子提交即可。
- 除非用户明确要求，不推远端、不 rebase、不 amend 已提交的 commit。

## 预览与工作流
- `client/public/card-preview.html` 是独立样例页，Vite 会把 `public/*` 拷到 `dist/`。
- 静态预览改动同步方式：`cp client/public/... client/dist/...`，不用重新构建。
