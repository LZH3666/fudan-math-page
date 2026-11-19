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
