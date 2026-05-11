<div align="center">
<img src="./build/icon_v2.ico" height="95" />
<h2>PaperMind</h2>
一个面向 Ask + RAG 科研工作流优化的学术文献管理工具。
<br />
<img src="https://img.shields.io/badge/version-3.6.1-4c1" />
<img src="https://img.shields.io/badge/license-GPL--3.0-blue" />
<img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-666" />
</div>

## 项目定位

## 我新增的重点功能

- 基于 Embedding 的本地向量数据库与语义检索链路（PGlite + pgvector）。
- Ask 回答中的引用源数字标记。
- 悬浮引用标记可查看“该引用对应”的证据原文片段。
- 引用证据映射链路优化，减少重复/不准的同句复用。
- 双击引用标记可直接打开来源 PDF。
- Ask 回答一键复制，复制成功后显示勾选反馈。
- Quickpaste Ask 布局、高度、底栏可见性等交互优化。

## 3.6.1 更新

- 欢迎页版本更新为 3.6.1。
- Quickpaste Ask 交互细节优化（底栏可见性、动态高度行为）。
- 引用悬浮交互与来源打开链路优化。
- Ask 引用证据映射质量提升（按引用关联证据）。

## 为什么做这个分支

我的核心需求是：在本地文献上下文中问答后，能够快速追溯回答中的每条引用证据，并直接回到源 PDF。  
这个分支主要就是围绕这个科研使用场景做增强。

## 快速开始

- 安装并运行：
  - `pnpm install`
  - `pnpm dev`
- 构建示例：
  - `pnpm build-win`
  - `pnpm build-mac-arm`
  - `pnpm build-linux`

## 致谢

底层架构与大量基础能力来自原始 Paperlib 项目及其贡献者。

## 许可证

由于本项目基于 GPL 上游代码进行修改与分发，本分支仍使用 **GPL-3.0**。  
详见 [LICENSE](./LICENSE)。
