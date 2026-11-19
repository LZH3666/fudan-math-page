# 复旦数学资源库

复旦数学资源库汇集课程资料和试卷。这里欢迎大家一起改进网站。[访问复旦数学资源库](https://fdmathpage.com/)

## 参与协作

- **反馈问题或提建议**。请附上相关网页，说明你遇到的情况和希望的结果。[提交 Issue](https://github.com/LZH3666/fudan-math-page/issues/new)
- **提交代码改动**。登录 GitHub 后 Fork 仓库，在自己的副本中修改，再向本仓库的 `main` 分支提交 Pull Request。请简述改动和验证结果。[查看 Pull requests](https://github.com/LZH3666/fudan-math-page/pulls)

维护者审查并合并 PR，网站更新另行发布。

## 仓库结构

- `website/` 存放服务端程序和依赖清单，负责课程页面、账号及讨论等功能。
- `website/dist/` 存放浏览器端页面、样式和交互代码。
- `website/banana-runtime/` 提供 Markdown 和数学排版。
- `website/scripts/` 存放构建和维护脚本，`website/tests/` 存放测试。
- `website/deploy/` 存放部署配置示例和排版测试样例，`website/readonly-template/` 提供只读导出模板。

仓库用于协作改进网站程序。课程资料、试卷和课程评价请在复旦数学资源库查看。

## 源码与正式站

正式站按功能分批发布，GitHub 上的源码用于公开协作。每次发布使用对应版本的构建产物，因此仓库与正式站的文件可能不同。

2026 年 11 月 19 日，对照[公开源码快照](https://github.com/LZH3666/fudan-math-page/commit/3f625cf50458eebd69b4e62f57d141e7ac47b2a0)核对了正式站的 67 个核心文件。55 个内容一致，10 个有差异，2 个未随正式站发布。

<details>
<summary>查看 10 个文件的差异</summary>

| 文件 | 差异原因 |
| --- | --- |
| `app.js`、`catalog.mjs`、`model.mjs` | 仓库包含更多课程分类入口、初始分类和数学分析 B 的旧链接兼容。正式站那次导航发布保留了原有入口，实际课程目录以网站为准。 |
| `style.css` | 仓库包含窄屏时标题与管理按钮的换行调整。 |
| `reader-layout.mjs`、`server.mjs` | 仓库包含试卷卷首精简和重复题号处理。正式站由服务器识别大学数学试卷，并在阅读时隐藏卷内题目目录。 |
| `fitness.js`、`fitness-score.mjs` | 仓库在缺少评分表时显示提示，公开版的评分计算按评分标准独立实现。正式站使用发布时配置的评分表和评分实现。 |
| `index.html` | 构建生成的静态资源版本号不同。 |
| `package.json` | 仓库保留构建、发布检查和专项测试命令。正式站使用已构建的资源，两边的依赖版本一致。 |

</details>

`document-search-ui.js` 和 `document-search.mjs` 属于暂缓启用的「文件收集」搜索功能。正式站保留分组列表，仓库保留这两个文件供后续恢复使用。
