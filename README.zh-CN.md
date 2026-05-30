<p align="center">
  <img src="docs/assets/proofhound-logo.svg" alt="ProofHound Logo" width="96" height="96" />
</p>

<h1 align="center">ProofHound</h1>

<p align="center">
  <b>让提示词工程大幅省力的自托管平台</b><br/>
  覆盖完整生命周期，内置数据驱动的自动优化。<br/>
  版本、回归测试、实验、优化、发布、回滚——数据与模型都在你自己手里。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="https://discord.gg/DGC6AzWrnt">Discord</a>
</p>

<p align="center">
  <a href="https://github.com/proofhound/proofhound"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proofhound/proofhound?style=flat&logo=github&label=Stars" /></a>
  <a href="https://discord.gg/DGC6AzWrnt"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <img alt="Node.js 24.x" src="https://img.shields.io/badge/Node.js-24.x-339933?logo=nodedotjs&logoColor=white" />
  <img alt="pnpm 10.x" src="https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white" />
  <img alt="TypeScript 6.x" src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" />
  <img alt="PostgreSQL first" src="https://img.shields.io/badge/PostgreSQL-first-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-ready-0F766E" />
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/8290f7f3-0fc8-4464-87b1-d351b3d54fb5" controls muted playsinline width="100%" title="ProofHound 快速开始演示"></video>
</p>

ProofHound 把提示词工程变成一条数据驱动、可追溯的工作流。不必再东拼西凑脚本、临时实验、表格和手写的上线逻辑——数据集回归、实验、自动优化、灰度与正式发布、不可变的运行结果与回滚，整条闭环都在一个地方完成，自托管在你自己掌控的基础设施上。

它首先为开发者而建：clone、`pnpm dev`、接上一个模型，几分钟就能开始做实验。而因为整套调优流程围绕数据集、指标和提示词版本被产品化，非技术成员也能定义目标、启动优化、推进发布。开源版以单工作区的本地管理端形态运行，并保留 `project_id` 数据边界，便于未来接入外部控制面而不改动核心资源语义。

## 能力清单

- **提示词版本** —— 不可变版本、可移动标签、变量清单、输出字段、判定规则与版本 diff
- **数据集回归** —— 支持 CSV / TSV / JSONL / JSON 数组 / ZIP 上传，字段角色映射，样本浏览、过滤与导出
- **实验** —— 提示词版本 × 数据集 × 模型 的批量回归，支持停止、恢复、对比与导出
- **自动优化** —— 分析失败样本与目标指标，生成候选版本，逐轮重跑
- **灰度与正式发布** —— 统一发布线路，支持切流、双跑、晋升、配置变更与回滚
- **运行结果** —— 实验、优化、灰度与正式发布的每一次 LLM 调用都写入同一份不可变记录
- **人工标注** —— 写入独立表，绝不修改原始运行结果
- **连接器** —— 把提示词接到队列连接器与 webhook 入站，承接线上流量
- **MCP 通道** —— 内置，Agent 可管理提示词版本、启动实验 / 优化、查询结果
- **自带模型** —— OpenAI、Azure OpenAI、Anthropic、DeepSeek 等，用你自己的 Key 与定价

## 功能导览

ProofHound 跑的是同一条生命周期，每个阶段都写入同一套事实表——所以一次模型调用从数据集样本一路到线上表现都可追溯，并能反查回来。按顺序往下看：

<!--
  截图 —— 产品总览（本节唯一主视觉）
  拍：最有代表性的界面，例如带指标的实验、或一条运行结果追溯。
  存到：docs/assets/screenshots/overview.png
  然后把本注释替换为：
  <p align="center"><img src="docs/assets/screenshots/overview.png" alt="ProofHound overview" width="100%" /></p>
-->

- **提示词版本** —— 每次修改都生成一个不可变版本，连同变量、输出字段与判定规则；一旦被实验、优化或发布引用即被冻结，因此每个结果都能对应到当时确切的提示词内容。
- **数据集回归** —— 用一个版本跑带期望输出的数据集，得到 Accuracy、Precision、Recall、F1、分类维度指标、失败样本与完整调用明细——而不是一个会掩盖少数类表现的整体分数。
- **实验** —— 批量跑 提示词版本 × 数据集 × 模型，可停止、恢复、跨轮对比并导出；因为所用版本已冻结，每次运行都可复现。
- **自动优化** —— 分析失败样本、生成新的候选版本、逐轮重跑回归，可针对类别级目标（例如提升某高风险类别的 Recall），并在某轮退步时回退到历史最佳版本。
- **灰度与正式发布** —— 把验证过的版本通过队列连接器做灰度发布，支持切流与双跑，再到 100% 晋升、配置变更、回滚与强制停止；webhook 入站可直接进入正式环境。
- **运行结果** —— 以上每个阶段的每次调用都写入一条不可变记录：输入变量、渲染后的提示词、原始输出、结构化输出、判定、耗时、Token 与成本。人工标注写入独立表，绝不修改原记录。

## 快速开始

你需要：

- Node.js 24
- pnpm
- Docker 与 Docker Compose

PostgreSQL、Redis 等本地依赖服务由 Docker Compose 自动启动，无需手动安装。

```bash
git clone https://github.com/proofhound/proofhound.git
cd proofhound
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` 会启动本地依赖服务、执行数据库迁移，并同时拉起 server、webhook、worker 和 web。

首次运行前，在 `.env` 里设置两个由应用自管的密钥（缺失会导致启动或调用模型失败）：

- `MODEL_API_KEY_ENCRYPTION_KEY` —— 加密你存储的模型 API Key
- `MCP_TOKEN_SIGNING_SECRET` —— 为 MCP Token 签名

`DATABASE_URL` 与 `REDIS_URL` 已指向 Docker Compose 启动的服务。

默认本地服务：

| 服务 | 地址 |
| --- | --- |
| 本地管理端 | http://localhost:3000 |
| 服务端 API | http://localhost:4000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| Kafka | localhost:9092 |
| Redpanda Console | http://localhost:8088 |
| RedisInsight | http://localhost:5540 |

<!--
  截图 —— 本地跑起来的样子
  拍：执行 `pnpm dev` 后的 ProofHound 首页 / 管理端，让读者看到刚启动的东西长什么样。
  存到：docs/assets/screenshots/home.png
  然后把本注释替换为：
  <p align="center"><img src="docs/assets/screenshots/home.png" alt="ProofHound running locally" width="100%" /></p>
-->

随时可跑完整检查：

```bash
pnpm ci
```

## 工作原理

ProofHound 是一个按模块边界拆分的 TypeScript 单体，配一个负责 LLM 调用的 Node.js worker。三个入口驱动它——本地管理端、给 Agent 与自动化用的 HTTP API + MCP 通道、以及按连接器划分的 webhook 入站——它们共享同一套编排与存储。

```mermaid
flowchart TD
    WEB[本地管理端 · apps/web]
    AGENT[Agent 与自动化<br/>HTTP API · MCP]
    HOOK[Webhook 入站 · apps/webhook]
    WEB --> SRV
    AGENT --> SRV[服务端 · NestJS · apps/server]
    HOOK --> SRV
    SRV --> ORCH[编排<br/>DBOS + BullMQ]
    ORCH --> WORK[LLM worker · apps/worker]
    WORK --> PROV[(你的模型供应商)]
    SRV --> PG[(PostgreSQL · Drizzle)]
    SRV --> REDIS[(Redis · 限流 + 队列)]
    SRV --> OBJ[(对象存储<br/>数据集 · 导出)]
    WORK --> PG
    WORK --> REDIS
```

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js + TypeScript + Refine + shadcn/ui + Tailwind |
| 后端 | NestJS 单体，按模块边界拆分 |
| 数据库 | PostgreSQL + Drizzle ORM（`ph_*` schema），不依赖专有 SQL 扩展 |
| 编排 | DBOS + BullMQ + Node.js LLM worker |
| 限流 | Redis 集中限流（RPM / TPM / 并发） |
| 存储 | 可替换的 `StorageProvider`（数据集与导出） |
| 日志 | Pino，stdout JSON；每次 LLM 调用在写入运行结果前都记录完整入参与响应 |

## 模型与供应商

ProofHound 不转卖模型调用，也不在用量上加价。你配置自己的供应商、endpoint、Key 与成本——花费只发生在你和你的供应商之间。

| 你来配置 | 内置供应商类型 |
| --- | --- |
| endpoint、API Key、定价、上下文窗口、图片能力，以及 RPM / TPM / 并发上限 | OpenAI · Azure OpenAI · Anthropic · DeepSeek · Kimi · MiniMax · Qwen · ERNIE —— 以及任何通过开放字符串接入的 OpenAI 兼容 endpoint |

## ProofHound 的不同之处

**靠数据事实，而非直觉。** ProofHound 把样本、判定、指标、失败模式与版本演化串成一条闭环。团队少花时间写脚本、临时定义结构、手工比对结果——提示词调优也不再只由少数工程师掌握。

**为分类与不均衡数据而建。** 开源版优先服务分类任务，尤其是风控、金融、审核、客服意图识别等类别不均衡明显的场景。per-class 指标贯穿始终，整体准确率绝不掩盖少数类的真实表现。

**从实验到生产的完整链路。** ProofHound 不只是提示词版本库，也不只是评测工具。数据集、实验、优化、发布与运行结果在同一条生命周期里——你能追溯一个版本为何上线、上线前跑过什么、灰度与正式环境表现如何、以及后来为何回滚。

**自托管，少绑定。** 存储用 PostgreSQL、集中限流用 Redis、日志走 stdout JSON——模型、凭证、供应商与用量成本都掌握在你自己手里。

## 路线图

- **生成式任务优化** —— 在当前以分类为先的流程之外，扩展面向生成式任务的评估、比较与优化策略。
- **ProofHound Cloud** —— 托管版，降低部署与运维成本。_即将上线。_

## 项目结构

```text
proofhound/
├── apps/
│   ├── server     # NestJS API、MCP 通道、SSE
│   ├── webhook    # 连接器 webhook 入站
│   ├── worker     # BullMQ LLM worker
│   └── web        # Next.js 本地管理端
├── packages/      # shared, db, crypto, providers, llm-client, judgment,
│                  # optimization-strategy, limiter, metrics, logger,
│                  # orchestration-shared, connector-client, api-client, ui
├── dev/           # 本地依赖服务的 docker-compose
├── docs/specs/    # 业务 SPEC —— 事实来源
└── datasets/      # 示例与本地数据集
```

## 参与贡献

ProofHound 还很早期，非常欢迎社区参与。你可以：

- 提 **Issue**：反馈 Bug、安装问题、模型接入问题或真实工作流反馈。
- 提 **Pull Request**：改进文档、修复问题、补充测试或优化交互体验。
- **扩展能力**：新增模型供应商、连接器、数据集解析、实验指标或优化策略。
- **分享场景**：尤其欢迎分类、不均衡数据集、风控、金融、审核、客服意图识别等场景。

如果不确定某个想法是否契合项目，建议先开 Issue 讨论背景与预期行为。

## 社区与支持

- **Discord** —— 最适合提问、求助安装、与其他用户交流：https://discord.gg/DGC6AzWrnt
- **GitHub Issues** —— 最适合 Bug、安装问题、模型接入问题与功能请求。
- **邮箱** —— 最适合私密或敏感话题：z@proofhound.org

## 许可证

ProofHound 基于 [Apache License 2.0](LICENSE) 开源。
