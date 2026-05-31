# 设计：`@proofhound/web-ui` 前端抽离（OSS 产品 UI 共享包 + 各 app 薄壳）

- 日期：2026/05/31
- 分支：`refactor/contracts-forroot-override`（与后端 `@proofhound/core` PR0 同源）
- 决策人：ZiqiXiao
- 状态：设计已获批，待写实现计划（writing-plans）

## 0. 背景与动机

SaaS（独立仓库）要复用 OSS 的产品页面（prompt / dataset / experiment / optimization /
release / connector / run-results 那套）。已证实的现状：

- `@proofhound/ui` 仅 `export {};`（纯空占位，注释引用了不存在的 `07 §6.13`）。
- OSS 全部产品 UI（38 路由页、65 组件、20 hooks、~5900 行 i18n、`features/`/`providers/`/`lib/`）
  全压在 `apps/web/src` 内，一个都没抽成包，独立 SaaS 仓库 import 不进来。

后端能搭薄壳，是因为先把业务模块抽进了 `@proofhound/core`
（`ProofHoundServerModule.forRoot({ contracts: LocalContractsModule })`，`apps/server` 退薄壳）。
前端要薄壳复用，**前置条件同构**：先把 `apps/web/src` 的产品 UI 抽进一个可发布的共享包，
各 app（OSS / SaaS）退成薄壳。本设计就是这个抽离方案。

> 与 spec 08 的关系（重要）：08 §4 当前把"前端复用"定成「适配器注入、SAME frontend code、
> **不做代码抽取**」。本设计**升级** §4——把"业务码 OSS/SaaS 一致"的既有意图从"手挥"变成
> "物理可复用的共享包"。08 既有的硬约束全部保留：`AuthSource`、`X-Project-Id`、不建项目切换器、
> 无 `IS_PLATFORM` 版本旗标、user token 不入 localStorage。按硬约束 #1（改码先改 SPEC），
> spec 改动作为 PR-web-1 先行。

## 1. 测绘结论（抽离赖以成立的事实）

1. **路由层已是薄壳**：所有 `app/**/page.tsx` 是 5–18 行瘦包装，业务逻辑全在同目录
   `_components/*-page.tsx`（`optimization-detail-page` 4700+ 行、`prompt-detail-page` 2489 行）。
   唯一胖页 `dashboard/page.tsx`（903 行）。
2. **数据层干净三层**：`@proofhound/api-client`(axios, C1) → `hooks/`(React Query, C2) →
   页面/组件(C3)。**Refine 只做路由 context，不做数据**；DTO 全来自 `@proofhound/shared`(Zod)。
   无 SSE，实时靠 5s 轮询（`refetchInterval`）。
3. **组件三档**：(a) 31 纯 shadcn 原子件（零耦合）；(b) 12 产品域组件（耦合 i18n + shared 类型）；
   (c) 14 app-shell/chrome（耦合 `next/navigation` + 业务 hooks + providers）。
4. **屏体与 chrome 接缝干净**：26 屏体只从 layout 引 `Main`（内容区 `<main>` 容器原语）；
   `AppShell` 仅在 `app/layout.tsx` 装配。屏体**不** import AppShell。
5. **客户端接缝就两个**：`ProjectContextProvider`（写死返回 `LOCAL_PROJECT_CONTEXT`）+
   `AuthSource`（规划在 api-client）。客户端无 auth/accessControl provider。
6. **api-client 现状**：裸 `axios.create({ baseURL: getServerBaseUrl() })` 单例，
   **`AuthSource`/`X-Project-Id` 拦截器尚未实现**（08 §4 只写了计划）。
7. **i18n**：单一巨字典（`apps/web/src/i18n/index.tsx`，~5900 行，zh-CN/en-US 各 2868 key），
   `I18nProvider({children, defaultLanguage})` + `useI18n()→{language,setLanguage,t}`，
   `t:(key: TranslationKey)=>string`，`TranslationKey = keyof dictionaries['zh-CN']`，无缺失兜底。
8. **样式**：`globals.css` 用 OKLCH 主题变量 + 语义类（`.status-*`/`.role-*`）+ 动画，
   作用域在 document-root。Tailwind v4，content glob 已含 `../../packages/ui/src/**`。
9. **lib/ 引用面**：`@/lib/utils`(cn, 83) / `api-error`(18) / `format`(15) / `releases`(7) /
   `project-name`(4) / `uuid`(3) / `model-provider-type`(2) / `model-number`(1)。

## 2. 已定决策（5 项）

| # | 决策 | 选择 |
|---|---|---|
| D1 | 包形态 | **单个 `@proofhound/web-ui`** + subpath exports（镜像 `@proofhound/core`，与后端"抽单包、否决多 *-core"对称） |
| D2 | chrome 划界 | **chrome 全留各 app**；`@proofhound/web-ui` 只装可复用产品 UI；`@proofhound/ui` 装原子件（含 sidebar 原语） |
| D3 | override 接缝 | **单个 `<ProofHoundWebProvider contracts={localWebContracts}>`**（web 版 forRoot 同构，单一覆盖点） |
| D4 | i18n | **整字典 + provider 进包，provider 可扩展（`i18nExtend`）**；OSS chrome/settings key 随包（无害） |
| D5 | 交付节奏 | **PR-web-1 spec 先行 → PR-web-2 一个大抽离 PR**（对齐后端 PR0；diff 巨但原子） |

## 3. 目标架构

```
packages/
  ui/                       # 纯设计系统(已存在, 填实)
    src/primitives/         # 31 个 shadcn 原子件 (button/dialog/table/sidebar/...)
    src/lib/utils.ts        # cn() —— 83 处依赖
    src/layout/main.tsx     # Main 内容容器(26 屏体依赖) + 其它纯内容原语
    src/index.ts            # 删占位; 真实导出
  web/                      # 新: OSS 产品 UI 单包
    src/screens/            # 各 _components/*-page.tsx 屏体 (+ dashboard 胖页)
    src/components/         # 12 产品域组件 + charts + annotations 子件
    src/hooks/              # 17 域 hooks + 3 工具 hooks
    src/i18n/               # 整字典 + I18nProvider(可扩展) + language.ts
    src/providers/          # ProofHoundWebProvider / Refine / ProjectContext
    src/lib/                # format / api-error / releases / project-name / uuid / model-* 域工具
    src/features/           # model-quick-fill
    src/contracts/          # WebContracts 类型 + localWebContracts
    src/styles/globals.css  # CSS 变量/主题(随包, app 引入)
apps/web/                   # OSS 薄壳
  src/app/**/page.tsx       # 5-18 行瘦包装, import @proofhound/web-ui/screens
  src/components/layout/    # chrome 全留: AppShell/app-sidebar/nav-group/header/sidebar-data/theme
  src/app/layout.tsx        # <ProofHoundWebProvider contracts={localWebContracts}>
  src/styles/ 或 globals    # @import '@proofhound/web-ui/styles/globals.css'
apps/web (SaaS 仓库)/        # SaaS 薄壳: 自有 chrome(org/billing/切换器) + 同样 import @proofhound/web-ui/screens
```

依赖方向：`@proofhound/ui`（零业务）← `@proofhound/web-ui`（依赖 ui + api-client + shared）← `apps/web`（薄壳）。
`deps:check`（madge）须无新增环依赖。

## 4. 包导出契约

### 4.1 `@proofhound/ui`

| subpath | 内容 |
|---|---|
| `@proofhound/ui` / `./primitives` | 31 shadcn 原子件（含 `ui/sidebar` 原语）|
| `@proofhound/ui/lib` | `cn()`（已有 `clsx`+`tailwind-merge` 依赖）|
| `@proofhound/ui/layout` | `Main` 等纯内容容器原语 |

`app-sidebar.tsx`/`nav-group.tsx`（耦合 `usePathname`+业务 hooks）**不进 ui，留 app**。

### 4.2 `@proofhound/web-ui`

| subpath | 内容 |
|---|---|
| `@proofhound/web-ui/screens` | 各资源屏体（`DatasetsListScreen`、`PromptDetailScreen`…）+ dashboard 胖页 |
| `@proofhound/web-ui/hooks` | 17 域 hooks（签名不变，仍收 `projectId`）+ 工具 hooks |
| `@proofhound/web-ui/providers` | `ProofHoundWebProvider`、底层 Refine/ProjectContext/I18n provider |
| `@proofhound/web-ui/i18n` | 整字典 + `I18nProvider`/`useI18n` + `language` 工具 |
| `@proofhound/web-ui/components` | 12 产品域组件 + charts + annotation 子件 |
| `@proofhound/web-ui/lib` | `formatDateTime` / `getApiErrorMessage` / `releases` / `project-name` / `uuid` / `model-*` |
| `@proofhound/web-ui/contracts` | `WebContracts` 类型 + `localWebContracts` |
| `@proofhound/web-ui/styles/globals.css` | 主题 CSS 变量 / 语义类 / 动画 |

依赖：`peerDependencies` = `react`/`react-dom`/`next`；`dependencies` =
`@refinedev/core`、`@refinedev/nextjs-router`、`@tanstack/react-query`、`lucide-react`、
`@proofhound/ui`、`@proofhound/api-client`、`@proofhound/shared`、`clsx`/`tailwind-merge`（若 lib 需要）。
包是 Next-coupled，两边消费方都是 Next.js，可接受。

## 5. contracts 接缝（★核心，web 版 forRoot 同构）

```ts
// @proofhound/web-ui/contracts
export interface WebContracts {
  authSource: AuthSource;                 // OSS: LocalAuthSource(getToken()→null)
  projectContext: ProjectContextSource;   // OSS: 常量 LOCAL_PROJECT_CONTEXT
  baseUrl?: string;                        // 默认 NEXT_PUBLIC_SERVER_URL → localhost:4000
  i18nExtend?: Partial<Record<Language, Record<string, string>>>; // SaaS 控制台 key
}
export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};

// @proofhound/web-ui/providers
export function ProofHoundWebProvider({ contracts, children }: {
  contracts: WebContracts; children: ReactNode;
}) {
  // 1) configureApiClient({ authSource, baseUrl }) —— 注册 Authorization + X-Project-Id 拦截器
  // 2) <I18nProvider extend={contracts.i18nExtend}>
  //      <ProjectContextProvider value={contracts.projectContext}>
  //        <RefineProvider>{children}</RefineProvider>
}
```

OSS `apps/web/src/app/layout.tsx`：
```tsx
import { ProofHoundWebProvider } from '@proofhound/web-ui/providers';
import { localWebContracts } from '@proofhound/web-ui/contracts';
<ProofHoundWebProvider contracts={localWebContracts}>{children}</ProofHoundWebProvider>
```
SaaS：传 `{ authSource: SupabaseAuthSource, projectContext: <自家响应式源>, i18nExtend: saasConsoleDict }`。

**api-client 配置接缝（本次随抽离落地）**：api-client 现为裸单例，需加
`configureApiClient({ authSource, baseUrl })`，内部用 axios 请求拦截器：
- `Authorization`：仅当 `authSource.getToken()` 非 null 时附加（OSS 浏览器不发，符合 08）；
- `X-Project-Id`：从当前 ProjectContext 取（OSS=local；SaaS=多租户），实现 08 §4.1。

这把 08 §4.1/§4.2 从"纸面计划"变成"真实现"。**项目切换器 UI 属 SaaS 私有 chrome，不进共享包**，
故 08「前端不建切换器」对 `@proofhound/web-ui` 仍成立。`projectContext` 设计成可注入源
（OSS 传常量；SaaS 传响应式 hook/state 以支持运行时切项目）。

## 6. 路由共享机制

各 app 保留自己的 `app/**/page.tsx` 瘦包装（owns 路由树），直接
`import { DatasetsListScreen } from '@proofhound/web-ui/screens'`。好处：SaaS 能自由增删路由
（`/org`、`/billing`、`/(auth)/login`）、用自己的 chrome 包裹产品路由；OSS 路由树不变。
屏体仅依赖 `Main`（→ui）+ hooks + 注入的 ProjectContext，不 import AppShell。

## 7. i18n

整字典 + `I18nProvider`/`useI18n` 搬进 `@proofhound/web-ui/i18n`。Provider 增 `extend` 参数
（经 `ProofHoundWebProvider` 的 `contracts.i18nExtend` 传入），`t` 运行时合并查 base→extend。
类型：包内屏体按 `WebTranslationKey` 校验；app/SaaS 用泛型或模块增强追加自己的 key。
OSS chrome/settings key 随包（无害文案）。`zh-CN`/`en-US` 仍按硬约束 #13 同步、
日期格式 `YYYY/MM/DD HH:mm:ss`（#14）。

> 备忘：`DEFAULT_LANGUAGE='zh-CN'` 仅为 SSR/兜底；首访按 `localStorage → navigator.languages →
> 兜底` 选择（英文优先、按浏览器语言自动选的既有行为不变）。

## 8. 样式 / CSS 变量

`globals.css`（OKLCH 主题变量、`.status-*`/`.role-*` 语义类、动画 keyframes）搬进
`@proofhound/web-ui/src/styles/globals.css`，各 app 在全局 css `@import '@proofhound/web-ui/styles/globals.css'`。
Tailwind content glob 增 `../../packages/web/src/**/*.{ts,tsx}`（ui 的 glob 已在）。
语义 token 不动（硬约束 #15），不硬编码单主题色。

## 9. SPEC 改动（PR-web-1，先行）

1. **08 §4 重写**：前端复用从"纯适配器注入、无代码抽取"升级为"抽 `@proofhound/web-ui` 共享包 +
   各 app 薄壳 + `ProofHoundWebProvider({contracts})` 接缝"；显式说明 `AuthSource`/`X-Project-Id`/
   「不建切换器」「无版本旗标」「token 不入 localStorage」约束全部保留，且本次把 §4.1/§4.2 落地为真实现。
2. **07 §7**：三层中 C2/C3 归属由 `apps/web/src/*` 改为 `@proofhound/web-ui/*`；`apps/web` 记为薄壳
   （路由包装 + chrome + contracts 接线）；补 `@proofhound/web-ui` 包条目。
3. **07 §8 + `packages/ui` 占位注释**：修掉悬空 `§6.13` 引用，补 `@proofhound/ui`（原子件）与
   `@proofhound/web-ui`（产品 UI）的真实说明。

## 10. 交付与验证

- **PR-web-1**：仅 spec（08 §4 重写 + 07 §7/§8 + 占位注释修正）。
- **PR-web-2**：一个大抽离 PR——建 `@proofhound/web-ui`、填 `@proofhound/ui`、
  搬 hooks/i18n/组件/屏体/lib/styles、加 api-client 配置接缝、`ProofHoundWebProvider`+`localWebContracts`、
  apps/web 退薄壳（路由瘦包装改 import 共享包；layout 包 `ProofHoundWebProvider`；chrome 留 app）。
- **门禁**：`pnpm ci`（typecheck + lint + test + deps:check + spec:terms）绿 +
  功能级 e2e 套件（`test/full-e2e-suite` 分支，假 LLM 桩 + 真 worker；跑前从 worktree `pnpm dev`
  起 web :3000 以满足 CORS）。`deps:check` 须无新增环依赖。

## 11. 风险 / 待 writing-plans 细化

- **巨 diff**：65 组件 + 38 屏体 + 5900 行 i18n 单 PR，review 重——已知并接受（对齐后端 PR0）。
- **api-client 配置接缝**：实质把 08 §4 的 `AuthSource`/`X-Project-Id` 一并落地，scope 比纯搬文件略大，
  属同一接缝、合并做最自然。
- **i18n 泛型类型**：`t` 接受 `base | extend` key 的类型化（泛型 vs 模块增强），实现细节留 writing-plans。
- **`'use client'` 边界**：providers/screens 多为 client component，包内各文件保留 `'use client'`；
  `app/layout.tsx`（async server component）只引 client 的 `ProofHoundWebProvider`，边界不变。
- **`Main` 之外的 layout 依赖**：`not-found.tsx` 引 `preference-controls`、`comparisons` 引
  `empty-route-page` —— 这些是 app 级页面，连同 chrome 留 app；不影响屏体抽离。
- **测试搬迁**：`_components/__tests__`（datasets/optimizations）与组件一起搬入 `@proofhound/web-ui`，
  Vitest 配置随包；覆盖 Service/纯函数的单测口径不变（DoD）。
