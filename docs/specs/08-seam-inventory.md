# 08b · Seam / DI 落点清单与审计

本文件是 [08 Control Plane Adapter Boundary](08-adapter-extension-points.md) 的**代码落点配套清单**：08 定义每个扩展点的契约与默认实现，本文件记录每个 seam 在代码里**绑定在哪、被谁消费、绑定层级是否可覆盖**，用于一次性审视"当前保留的 seam 是否合理、是否有未正确暴露的地方"。

> 范围：仅清点遵循 DI / seam 设计的可替换点（抽象类 DI token + `WebContracts` 注入字段），不含普通 Repository / Service 的内部依赖注入。术语沿用 08：`external consumer` / `host shell` / `replacement implementation` / `override`，不引入 SaaS 措辞。

装配机制一句话：后端三运行时（server / webhook / worker）都经 `forRoot({ contracts })` 单点注入同一个 `@Global` 的 `LocalContractsModule`；前端经单个 `<ProofHoundWebProvider contracts>` 注入 `WebContracts`。替换只发生在这两个装配点。

---

## 1. 后端 seam 落点

### 1.1 经 `LocalContractsModule` 绑定（`forRoot({ contracts })` 可覆盖）

绑定清单见 `packages/core/src/server/common/contracts/local-contracts.module.ts:47-60`；抽象类同目录 `*.resolver.ts` / `*.service.ts` / `*.hook.ts` / `*.provider.ts` / `*.strategy.ts`。

| # | Seam（抽象类） | OSS 默认实现 | 主要消费方（controller / service · 方法） | 功能 / 调用时机 |
| - | -------------- | ------------ | ----------------------------------------- | --------------- |
| 1 | `ProjectContextResolver` | `LocalProjectContextResolver` | `HttpActorGuard.canActivate`（经 `@CurrentProject()` 读取）、`McpDispatchContextFactory.build`、release / optimization recovery | actor + hint → `ProjectContext` 并校验项目访问权；OSS 恒返回 `LOCAL_PROJECT_CONTEXT` 不校验 |
| 2 | `ActorContextResolver` | `LocalActorContextResolver` | `HttpActorGuard.canActivate` → `resolveFromHttp` | HTTP 身份（API `ph_*` user token / UI 可信头 / LOCAL_ACTOR）→ `ActorContext` |
| 3 | `McpAuthResolver` | `LocalMcpAuthResolver` | `McpDispatchContextFactory.build` → `resolveFromMcp` | MCP user token → `ActorContext`（与 §2 互不调用） |
| 4 | `ConnectorContextResolver` | `LocalConnectorContextResolver` | `WebhookService.executeConnectorHook` / `recordProbeResult` | webhook token →（connector + `ProjectContext` + system actor），不经 §1 |
| 5 | `TokenService` | `LocalTokenService` | `TokenController.list/create/update/reveal/deleteUserToken` | user token（`scope='user'`）CRUD；不碰 `scope='webhook'` |
| 6 | `AccessControlService` | `LocalAccessControlService` | `DatasetService` / `DatasetImportService` / `ProductionReleaseService` / `RunResultService` · `assertCan`；`McpDispatchContextFactory.build`（`mcp_tool`） | `(actor, project, action)` 授权网关；OSS 仅看 `actorKind` |
| 7 | `LimiterKeyStrategy` | `LocalLimiterKeyStrategy` | `BullmqService.enqueueLlm/ProbeJob`、`LlmRunner` / `ProbeRunner.run`、webhook bullmq | 生成限流 key（OSS `model:<modelId>`）；`@proofhound/limiter` 保持无项目感 |
| 8 | `RuntimeLimitsProvider` | `LocalRuntimeLimitsProvider` | `LlmAdmissionDispatcher`、`LlmRunner` / `ProbeRunner.run` → `mergeLlmLimits` | 折叠部署级 RPM/TPM/并发上限到每次调用；OSS 为 pass-through |
| 9 | `QuotaPolicyHook` | `LocalQuotaPolicyHook` | `DrizzleRunResultWriter.writeRunResult`、`DatasetService` / `DatasetImportService.assertCanStore`、`LlmRunner` / `ProbeRunner` → `withExecutionSlot` | 写入/执行点的存储配额 + 执行槽准入；OSS no-op |
| 10 | `UsageMeteringHook` | `NoopUsageMeteringHook` | `DrizzleRunResultWriter`、`DatasetService`、`LlmRunner`（job 生命周期）经 `safeRecordUsageEvent` | 业务事实发生后发用量事件（只记录、O(1)）；OSS no-op |
| 11 | `WorkflowAuthorizationHook` | `LocalWorkflowAuthorizationHook` | `ProductionReleaseService.recordProductionEvent`、`OptimizationService`、`WebhookService.executeConnectorHook` | workflow / job 入队前授权（`experiment`/`optimization`/`release`/`llm`/`probe`）；OSS 放行 |
| 12 | `DatasetUploadService` | `LocalDatasetUploadService` | `DatasetController.uploadDataset` | 数据集文件接收 / 解析 / promote（写侧）；OSS 同步 Multer→inline DB |
| 13 | `DatasetSampleRepository` | `LocalDatasetSampleRepository` | `DatasetService`（样本分页 / 搜索 / 分类分布）、`ExperimentWorkflow` / `OptimizationWorkflow` 渲染 | 数据集样本读侧（渲染 / 预览 / 搜索 / 导出）；OSS inline 读 `dataset_samples.data` |

### 1.2 非 provider 的入口基类

| Seam | 形态 | 引用点 | 功能 |
| ---- | ---- | ------ | ---- |
| `HttpActorGuard` | 可执行基类（`@UseGuards(HttpActorGuard)`，非 DI token） | 15 个 HTTP Controller（token / dataset / prompt / experiment / optimization / canary-release / production-release / release-line / run-result / annotation / connector / model / project-model / quick-start / monitoring）；MCP controller 显式排除 | 调 `ActorContextResolver` + `ProjectContextResolver`，把 `request.user` / `request.projectContext` 填好；替换认证只换 §2，不换本类（08 §3.9） |

### 1.3 ⚠️ 绑定在 feature module（`forRoot({ contracts })` **不可**覆盖）

这三个是抽象类 seam，但 provider 绑定在各自 feature module，会**遮蔽**任何全局 contracts 绑定 → 当前形态下 host 无法经 `forRoot` 替换。08 §3 的扩展点清单也未收录它们。

| Seam | OSS 默认实现 | 绑定位置 | 消费方 · 方法 | 功能 |
| ---- | ------------ | -------- | ------------- | ---- |
| `DatasetDeletionHook` | `LocalDatasetDeletionHook` | `DatasetModule` (`dataset.module.ts:17`) | `DatasetService.getDatasetDeleteImpact` / `deleteDataset` | 永久删除前的影响清单（关联实验 / 优化） |
| `ReleaseLineDeletionHook` | `LocalReleaseLineDeletionHook` | `ReleaseLineModule` (`release-line.module.ts:21`) | `ReleaseLineService.getDeleteImpact` | 删除发布线的影响清单 |
| `PromptDeletionHook` | `LocalPromptDeletionHook` | `PromptModule` (`prompt.module.ts:15`) | `PromptService.getDeleteImpact` | 删除 prompt / 版本的影响清单 |

> 对照：`DatasetUploadService` / `DatasetSampleRepository` 同样定义在 dataset 目录，但**有意**放进 `LocalContractsModule`（`dataset.module.ts:8-11` 注释明确"放 global 以免 feature module 遮蔽"）。deletion hook 留在 feature-local 是与之相反的选择，见 §3 审计 B1。

---

## 2. 前端 seam 落点

入口：`WebContracts`（`packages/web-ui/src/contracts/index.ts`）→ `ProofHoundWebProvider`（`packages/web-ui/src/providers/proofhound-web-provider.tsx`）单点注入；OSS 默认 `localWebContracts` 只填 `authSource` + `projectContext`，其余字段 OSS 留空走 fallback。

| WebContracts 字段 | 消费 Provider / 函数 | 暴露 hook / 行为 | OSS 默认 | 性质 |
| ----------------- | -------------------- | ---------------- | -------- | ---- |
| `authSource` | `configureApiClient`（`api-client/src/configure.ts`）拦截器 | 请求注入 `Authorization: Bearer` | `LocalAuthSource.getToken()→null`（浏览器不带凭证） | host seam |
| `projectContext` | `ProjectContextProvider` + `getProjectId` | `useProjectContext`；并注入 `X-Project-Id` 头 | `LOCAL_PROJECT_CONTEXT` | host seam |
| `baseUrl` | `configureApiClient` | 设 `httpClient.defaults.baseURL` | `undefined`（用 `getServerBaseUrl()`） | host seam（可选） |
| `webhookBaseUrl` | `WebhookEndpointProvider` | `useWebhookEndpoint` / `buildWebhookUrl`（connector 详情页） | `undefined`（占位符 `$PROOFHOUND_API_ORIGIN`） | host seam（可选） |
| `i18nExtend` | `I18nProvider` | `useI18n().t` 先查 extend | `undefined`（仅内置中英字典） | host seam（可选） |
| `displayPreferences` | `DisplayPreferencesProvider` | `useDisplayPreferences`（时区偏好，~20 屏的 `useDateTimeFormatter`） | `undefined` → localStorage + 浏览器自动 | **OSS 内部状态兼 host seam**（见 B3） |
| `runtimeLimits` | `RuntimeLimitsProvider` | `useRuntimeLimits` + `capConcurrencyValue` / `resolveEffectiveConcurrencyLimit`（release / experiment / optimization / model 表单的并发输入约束） | `undefined` → `{}`（无 UI 上限） | host seam（OSS fallback 无限制；见 B4） |
| `resolveHref` | `NavigationProvider` | `useResolveHref` + `Link`（`components/navigation/link`）/ `useRouter`（`hooks/use-router`）两个 wrapper | identity（不改写） | host seam |
| `datasetUpload` | `DatasetUploadProvider` | `useDatasetUploadAdapter`（`(projectId,file,meta)→DatasetImportStatusDto`），上传页用 | `defaultAdapter` = `datasetImportClient.uploadDataset`（multipart） | host seam（08 §3.13） |
| `datasetUploadMaxBytes` | `DatasetUploadProvider` | `useDatasetUploadMaxBytes`（上传页前置大小校验） | 100MB（env `DATASET_UPLOAD_MAX_BYTES`，SSR 注入） | OSS 配置 + host seam |

配套基础设施：

- `AuthSource` 抽象类 + `LocalAuthSource` 默认实现：`packages/api-client/src/auth-source.ts`。
- `configureApiClient`（`packages/api-client/src/configure.ts`）：`ProofHoundWebProvider` 首渲染（`useState` initializer）即注册幂等 axios 请求拦截器，注入 `Authorization` + `X-Project-Id`；screens / hooks 不直接读 `authSource` / `projectContext`。
- 导航 wrapper 的护栏：`packages/web-ui/eslint.config.mjs` 的 `no-restricted-imports` 禁止 screens 直接 `import next/link` / `useRouter`，强制走 wrapper（08 §4.3）。

---

## 3. 审计：是否合理 / 是否有未正确暴露

### 3.1 合理（保持现状）

- **后端 13 个 contracts seam 统一在 `LocalContractsModule`、`forRoot` 单点可覆盖、三运行时共享同一绑定** —— 与 08 §2 一致，是干净的开核 + 适配覆盖形态。
- **三入口 resolver（Actor / Mcp / Connector）互不调用、凭证系统物理隔离** —— 符合 08 §3 与 CLAUDE.md §8。
- **`HttpActorGuard` 作为可执行基类不进 provider 表** —— 是 Nest `@UseGuards` 机制使然，非疏漏（08 §3.9），替换认证换 §2 即可。
- **`LimiterKeyStrategy` / `RuntimeLimitsProvider` / `QuotaPolicyHook` / `UsageMeteringHook` 把 project/org 留在 core、`limiter` / `llm-client` 保持无感** —— 符合 08 §6。
- **前端 `WebContracts` 单点注入；`authSource` / `resolveHref` / `datasetUpload` 是边界清晰的 host 覆盖点** —— 合理。

### 3.2 待决 / 不一致（建议项，最终由 ZiqiXiao 定夺）

- **B1【绑定层级不当 —— 重点】** `DatasetDeletionHook` / `ReleaseLineDeletionHook` / `PromptDeletionHook` 是抽象类 seam，却绑定在 feature module，**`forRoot({ contracts })` 无法覆盖**，且不在 08 §3 清单。需要明确它们的定位：
  - 若仅为内部抽象（DRY / 可测 + CLAUDE.md rule 4 的"先跑删除钩子列影响再级联"业务流）：它们**不该**被当作对外扩展点，应在 08 显式归类为"内部 hook，不在 `forRoot` 覆盖面"，消除"抽象类 = 可覆盖 seam"的歧义。
  - 若希望可覆盖：应像 `DatasetUploadService` / `DatasetSampleRepository` 那样**上提到 `LocalContractsModule`**，feature module 不再绑定。
  - 倾向判断：删除影响 / 级联语义由 rule 4 固定为 OSS 业务逻辑，不是 host 需要替换的点 → 倾向"内部抽象"，建议走第一条（文档归类，不动绑定）。
- **B2【文档漂移】** 08 §4 的 `WebContracts` 类型块（约 743–756 行）已过期：实际多出 `displayPreferences` / `runtimeLimits` / `datasetUpload` / `datasetUploadMaxBytes` 四个字段未在类型块列全。建议同步 08 §4。
- **B3【性质模糊】** `displayPreferences` 主要是 OSS 自用的时区偏好（localStorage + 自动），被顺带做成可注入；当前无明确 host 覆盖诉求。建议：要么在 08 标注为"OSS 内部状态优先、host 覆盖可选"，要么从 `WebContracts` 移除退回纯内部状态，避免与真正的 host seam 混淆。
- **B4【同名两个 seam】** 前端 `runtimeLimits`（UI 输入约束/提示）与后端 `RuntimeLimitsProvider`（§1.1 第 8 项，worker 硬上限 enforce）同名但**是两个独立 seam**。08 §4 未提前端这个。建议文档澄清二者关系（UI 软约束 vs 服务端硬上限），避免误读为同一处。
- **B5【无硬缺口】** 扫 `packages/core/src` 全部 `export abstract class` 未发现"应暴露却完全没暴露"的遗漏点；现存问题集中在"暴露层级不当（B1）"和"文档未同步（B2/B4）"，而非缺 seam。

---

## 4. 与其它 SPEC 的关系

- [08 Control Plane Adapter Boundary](08-adapter-extension-points.md)：本文件是其代码落点配套；B1–B4 的结论应回填到 08 对应小节。
- [07 Code Structure](07-code-structure.md)：`@proofhound/core` / `@proofhound/web-ui` 的包边界。
- [22 Datasets](22-datasets.md)：`DatasetUploadService`（§3.1.1）/ `DatasetSampleRepository` 的业务上下文。
