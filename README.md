<div align="center">
<img src="./build/icon_v2.ico" height="95" />
<br />
<h2>PaperMind</h2>
An improved academic paper management tool focused on Ask + RAG research workflow.
<br />

<img src="https://img.shields.io/badge/version-3.6.1-4c1" />
<img src="https://img.shields.io/badge/license-GPL--3.0-blue" />
<img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-666" />
</div>

## Project Positioning

This repository is a **fork based on Paperlib**.
I am an undergraduate student who found Paperlib very useful for daily research reading and writing, so I extended it with better RAG and citation-evidence interactions.

## What I Added

- Embedding-based local vector database and semantic retrieval workflow (PGlite + pgvector).
- Ask-mode citation source markers in answers.
- Hover citation markers to view citation-specific evidence excerpts.
- Improved evidence mapping chain to reduce repeated/irrelevant quote reuse.
- Double-click citation markers to open the source PDF directly.
- One-click answer copy with success-check interaction.
- Quickpaste Ask layout/height/footer interaction refinements.

## 3.6.1 Update

- Welcome page updated to 3.6.1.
- Quickpaste Ask interaction polish (footer visibility, dynamic sizing behavior).
- Citation hover UX improvements and source-opening flow.
- Ask evidence-chain quality improvements for per-citation mapping.

## Why This Fork

In my own workflow, I often read papers, ask follow-up questions with local context, and need quick, reliable evidence backtracking from answers to sources.
This fork is mainly for that use case.

## Quick Start

- Build and run:
  - `pnpm install`
  - `pnpm dev`
- Production build examples:
  - `pnpm build-win`
  - `pnpm build-mac-arm`
  - `pnpm build-linux`

## Acknowledgement

Core architecture and many foundational features come from the original Paperlib project by Future-Scholars and contributors.

## License

This fork remains under **GPL-3.0** because it is based on GPL-licensed upstream code.
See [LICENSE](./LICENSE).
