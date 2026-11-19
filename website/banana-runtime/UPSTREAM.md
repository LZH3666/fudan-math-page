# 官方排版工具来源

- 来源：https://github.com/banana-space/banana
- 固定参考提交：4aaa8bd321dbfe2323c3ffa0d15dd09084ea2cdb
- 原LICENSE（MIT）原样保留；课程内容许可不由代码许可决定。
- 本项目适配：hugo.toml名称及嵌入模式；baseof.html隐藏嵌入页重复导航/页脚，避免错误上游源码归属说明；render-link.html保留本项目/media附件根路径；postbuild/tikz.mjs在compile/acquire入口禁止宿主TeX worker。
- 官方参考目录只读。本目录是独立可部署副本；npm ci安装锁定依赖，Hugo Extended 0.167.0由FUDAN_HUGO_DIR或website/tools/hugo提供。
- 已接入同课程多页collection.yaml、父子章节、共享标签及隔离TikZ/交换图/复杂公式SVG桥接。原编号通过手动标题和标签保留，中文句号自动替换关闭；跨章链接经过本项目文档路由适配。
- 旧TeX自定义宏在迁移时按原定义展开，不要求作者在Markdown公式内使用主站禁止的宏定义。真实源码注释保留为不可见HTML注释；可见数学comment转换remark。
- 为保留旧TeX手动公式/图形编号，迁移源码含不可见FudanAnchor注释，本项目适配器将其转换为链接锚点。将来提交主站时还须按主站允许的标签位置导出这些锚点，处理附件路径及collection.yaml，并显式导出旧图形所需的共享TeX样式/库；本机桥接的预置样式不能假定主站都有。不能声称无需任何导出适配即可提交。
- 官方工具和模板已复用；全量资料的具体通过/保留范围以deploy/MARKDOWN-MIGRATION-STATUS.md及逐页报告为准。未知源格式与原文编译疑问保留原版，不视为手册全部功能已验收。
