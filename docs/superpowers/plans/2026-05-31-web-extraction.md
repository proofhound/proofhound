# `@proofhound/web-ui` 前端抽离 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OSS `apps/web/src` 的产品 UI 抽进单个共享包 `@proofhound/web-ui`（+填实 `@proofhound/ui`），`apps/web` 退薄壳，使独立 SaaS 仓库能以薄壳复用同一份产品页面。

**Architecture:** 镜像后端 `@proofhound/core` 的"抽单包 + subpath exports + `forRoot({contracts})`"范式。`@proofhound/ui`=零业务设计系统（原子件 + `cn` + `Main` + 纯 UI hooks + `UiStringsContext`）；`@proofhound/web-ui`=产品 UI（screens/hooks/i18n/providers/components/lib/contracts）。OSS/SaaS 各自的 `apps/web` 用 `<ProofHoundWebProvider contracts={...}>` 注入差异（authSource / projectContext / i18nExtend / baseUrl）。chrome（AppShell/sidebar/nav）留各 app。

**Tech Stack:** pnpm@10 + turbo monorepo；TS-source 包消费（`main/types→src/index.ts`、`exports→./src/*.ts`、`tsconfig.base.json` paths、Next `transpilePackages`）；Next.js 15 App Router + Refine(routing-only) + React Query + shadcn/Tailwind v4 + Vitest。

**设计来源：** `docs/superpowers/specs/2026-05-31-web-extraction-design.md`（已获批）。

---

## 全局约定（所有任务复用，DRY）

### G1. 包内 import 重指向规则（核心）

`@/*` 别名**不能**跨 Next `transpilePackages` 边界（消费 app 的 `@/*` 会把包内 `@/hooks` 错解析到 `apps/web/src`）。因此**搬进 `packages/web/` 或 `packages/ui/` 的文件，其 `@/...` import 必须全部改写**：

| 原 import（在 apps/web） | 搬入包后改写为 |
|---|---|
| `@/components/ui/X` | `@proofhound/ui`（具名导出） |
| `@/components/layout/main` | `@proofhound/ui/layout`（`Main`） |
| `@/lib/utils`（`cn`） | `@proofhound/ui`（具名 `cn`） |
| `@/hooks/use-mobile` | `@proofhound/ui`（`useIsMobile`） |
| `@/hooks/X`（其余域 hooks） | 相对路径 `../hooks/X`（按文件深度算） |
| `@/i18n` | 相对路径 `../i18n` |
| `@/lib/X`（format/api-error/releases/project-name/uuid/model-*） | 相对 `../lib/X` |
| `@/components/X`（产品域组件） | 相对 `../components/X` |
| `@/providers/X` | 相对 `../providers/X` |
| `@/features/X` | 相对 `../features/X` |
| `@proofhound/shared`、`@proofhound/api-client` | 不变 |

`apps/web` 内**保留**的文件（路由瘦包装、chrome）只需把指向已搬走目标的 `@/...` 改成 `@proofhound/web-ui/*` 或 `@proofhound/ui`；chrome 之间的 `@/components/layout/*` 互引不变。

> 执行手法：每个搬迁任务后跑 `pnpm --filter @proofhound/web-ui typecheck`（或 ui），按 `tsc` 报的"Cannot find module"逐条改 import 直到绿。可写一次性 `node` + `ts-morph` 脚本批量改写，或用编辑器多文件替换；改完务必 typecheck 兜底。

### G2. 闸门命令

- 类型：`pnpm typecheck`（全量）/ `pnpm --filter @proofhound/web-ui typecheck`（单包）
- Lint：`pnpm lint`
- 单测：`pnpm test`（=test:unit）/ `pnpm --filter @proofhound/web-ui test`
- 环依赖：`pnpm deps:check`（madge）—— 必须无新增环
- 术语：`pnpm spec:terms`
- 全闸门：`pnpm run ci`（**注意：`pnpm ci` 会撞 pnpm 内建，必须 `pnpm run ci`**）
- e2e：功能级套件在 `test/full-e2e-suite` 分支（假 LLM 桩 + 真 worker）；**按 CLAUDE.md #17 不自行起服务**——需要时请 ZiqiXiao 起 `pnpm dev`（web :3000，CORS）后再跑。

### G3. 提交规范

Conventional Commits，特性分支（不直推 master）。本计划两段：
- **PR-web-1**（spec 先行）：分支 `docs/web-extraction-spec`（或在现有 `refactor/contracts-forroot-override` 上续）。
- **PR-web-2**（大抽离）：分支 `refactor/web-extraction`。一个 PR、内含多次按任务的提交。

---

# PR-web-1：SPEC 先行

> 硬约束 #1：改码先改 SPEC。本段只动文档，不碰代码。

### Task 1：重写 08 §4 前端复用策略

**Files:**
- Modify: `docs/specs/08-saas-adapter-boundary.md`（§4.1/§4.2，及 §8 前端约束、§3.2.1 附近的前端复用叙述）

- [ ] **Step 1：通读现状**

Run: 打开 `docs/specs/08-saas-adapter-boundary.md`，定位 §4.1（ProjectId transport / X-Project-Id，约 453–486 行）、§4.2（AuthSource，约 489–540 行）、§8（前端约束，约 622–635 行）。确认当前措辞是"SAME frontend code by overriding AuthSource，**不做代码抽取**"。

- [ ] **Step 2：改写 §4 主旨**

把"前端复用 = 纯适配器注入、无代码抽取"改写为下述主旨（中英以该文件既有语言为准，下面给中文意译，落笔时对齐原文风格）：

> 前端复用 = **抽 `@proofhound/web-ui` 共享包（产品 UI）+ `@proofhound/ui`（设计系统）+ 各 app 薄壳**。OSS/SaaS 各自的 `apps/web` 通过单一入口 `<ProofHoundWebProvider contracts={WebContracts}>` 注入差异。`WebContracts = { authSource, projectContext, baseUrl?, i18nExtend? }`。OSS 传 `localWebContracts`（`authSource=LocalAuthSource→null`、`projectContext=LOCAL_PROJECT_CONTEXT`）；SaaS 传 `{ authSource: SupabaseAuthSource, projectContext: <多租户响应式源>, i18nExtend: <控制台字典> }`。
>
> §4.1/§4.2 的 `X-Project-Id` 与 `AuthSource` **由 `@proofhound/web-ui` 的 `ProofHoundWebProvider` 在启动时通过 `configureApiClient({authSource, baseUrl})` 注册 axios 拦截器落地**（在此之前 httpClient 无拦截器）。

- [ ] **Step 3：保留并复述既有约束**

在 §4/§8 明确这些**不变**：`AuthSource` 抽象、`X-Project-Id` header、**`@proofhound/web-ui` 与 OSS `apps/web` 不建项目切换器**（切换器是 SaaS 私有 chrome，不在共享包）、无 `IS_PLATFORM` 版本旗标、user token 不入 localStorage/sessionStorage/cookie。

- [ ] **Step 4：术语校验**

Run: `pnpm spec:terms`
Expected: PASS（无非法术语）。

- [ ] **Step 5：提交**

```bash
git add docs/specs/08-saas-adapter-boundary.md
git commit -m "docs(specs): 08 §4 前端复用升级为 @proofhound/web-ui 共享包 + ProofHoundWebProvider 接缝"
```

### Task 2：更新 07 §7/§8 + 修 ui 占位悬空引用

**Files:**
- Modify: `docs/specs/07-code-structure.md`（§7 apps/web、§8 包清单、§9 Forbidden 若涉及）
- Modify: `packages/ui/src/index.ts`（占位注释里的悬空 `§6.13`）

- [ ] **Step 1：改 07 §7 三层归属**

把 C2（hooks）/C3（页面组件）的归属由 `apps/web/src/hooks` `apps/web/src/app/*` 改为 `@proofhound/web-ui/hooks` `@proofhound/web-ui/screens|components`；`apps/web` 标注为薄壳（路由瘦包装 + chrome `components/layout` + `ProofHoundWebProvider` 接线）。C1 仍是 `@proofhound/api-client`。

- [ ] **Step 2：补 07 §8 包清单**

新增 `@proofhound/web-ui`（产品 UI：screens/hooks/i18n/providers/components/lib/contracts）；把 `@proofhound/ui` 描述从"占位"改为"设计系统：shadcn 原子件 + `cn` + `Main` + 纯 UI hooks + `UiStringsContext`"。

- [ ] **Step 3：修 ui 占位注释**

`packages/ui/src/index.ts` 当前注释 `// Shared UI components (placeholder) — see docs/specs/07-code-structure.md §6.13` 引用了不存在的 §6.13。改为指向 07 §8 的真实条目（此步只改注释；填实在 PR-web-2 Task 6）。

- [ ] **Step 4：术语校验 + 提交**

Run: `pnpm spec:terms` → PASS

```bash
git add docs/specs/07-code-structure.md packages/ui/src/index.ts
git commit -m "docs(specs): 07 §7/§8 记 @proofhound/web-ui 薄壳化前端三层; 修 ui 占位悬空引用"
```

> PR-web-1 到此结束。开 PR 合并（或与 PR-web-2 串行）。**PR-web-2 以 spec 为准。**

---

# PR-web-2：一个大抽离 PR

> 内含多次按任务提交；全程 `pnpm --filter ... typecheck` 增量兜底，末尾 `pnpm run ci` + e2e。

### Task 3：脚手架 `@proofhound/web-ui` 包 + 接线

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/index.ts`（临时空 `export {}`）
- Create 占位空目录入口：`packages/web/src/{screens,hooks,providers,i18n,components,lib,contracts,features}/index.ts`（各 `export {}`）
- Create: `packages/web/src/styles/.gitkeep`
- Modify: `tsconfig.base.json`（paths 增 `@proofhound/web-ui` 系列）
- Modify: `apps/web/next.config.ts`（`transpilePackages` 增 `@proofhound/web-ui`）

- [ ] **Step 1：写 `packages/web/package.json`**

```jsonc
{
  "name": "@proofhound/web-ui",
  "version": "0.0.0",
  "private": true,
  "description": "ProofHound 可复用产品前端：screens / hooks / providers / i18n / components / contracts",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./screens": "./src/screens/index.ts",
    "./hooks": "./src/hooks/index.ts",
    "./providers": "./src/providers/index.ts",
    "./i18n": "./src/i18n/index.ts",
    "./components": "./src/components/index.ts",
    "./lib": "./src/lib/index.ts",
    "./contracts": "./src/contracts/index.ts",
    "./styles/globals.css": "./src/styles/globals.css"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.{ts,tsx}\"",
    "test": "vitest run",
    "test:unit": "vitest run",
    "clean": "rm -rf dist .turbo tsconfig.tsbuildinfo"
  },
  "dependencies": {
    "@proofhound/ui": "workspace:*",
    "@proofhound/api-client": "workspace:*",
    "@proofhound/shared": "workspace:*",
    "@refinedev/core": "<对齐 apps/web 版本>",
    "@refinedev/nextjs-router": "<对齐 apps/web 版本>",
    "@tanstack/react-query": "<对齐 apps/web 版本>",
    "axios": "<对齐 api-client 版本>",
    "clsx": "^2.1.1",
    "lucide-react": "<对齐 apps/web 版本>"
  },
  "peerDependencies": { "next": "^15", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": {
    "@types/node": "^24.12.4", "@types/react": "^19.2.14", "@types/react-dom": "^19.2.3",
    "react": "^19.2.6", "react-dom": "^19.2.6", "typescript": "^6.0.3", "vitest": "^4.1.6"
  }
}
```

> 精确版本号从 `apps/web/package.json` 拷贝对齐（refine / react-query / lucide-react / xyflow 等屏体实际用到的；Step 末 typecheck 会暴露缺失依赖，逐个补全）。

- [ ] **Step 2：写 `packages/web/tsconfig.json`**（镜像 `apps/web/tsconfig.json`，但**不要**定义 `@/*` paths——见 G1）

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["DOM", "DOM.Iterable", "ES2022"], "jsx": "preserve",
    "noEmit": true, "incremental": true, "baseUrl": "."
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3：写 `packages/web/vitest.config.ts`**（镜像 `apps/web` 的 vitest 设置：jsdom 环境、react 插件、tsconfig-paths）。从 `apps/web/vitest.config.*` 拷贝并去掉 `@/*` alias。

- [ ] **Step 4：建空 barrel**

各 subpath `index.ts` 先 `export {};`（占位，后续任务逐个填）。`packages/web/src/index.ts` 同样 `export {};`。

- [ ] **Step 5：接线 `tsconfig.base.json` paths**（紧随现有 `@proofhound/core/*` 之后）

```jsonc
"@proofhound/web-ui": ["./packages/web/src/index.ts"],
"@proofhound/web-ui/screens": ["./packages/web/src/screens/index.ts"],
"@proofhound/web-ui/hooks": ["./packages/web/src/hooks/index.ts"],
"@proofhound/web-ui/providers": ["./packages/web/src/providers/index.ts"],
"@proofhound/web-ui/i18n": ["./packages/web/src/i18n/index.ts"],
"@proofhound/web-ui/components": ["./packages/web/src/components/index.ts"],
"@proofhound/web-ui/lib": ["./packages/web/src/lib/index.ts"],
"@proofhound/web-ui/contracts": ["./packages/web/src/contracts/index.ts"]
```

- [ ] **Step 6：接线 Next transpilePackages**

`apps/web/next.config.ts` 的 `transpilePackages` 数组加 `'@proofhound/web-ui'`（已含 `@proofhound/ui`）。

- [ ] **Step 7：装依赖 + 验证**

Run: `pnpm install`
Run: `pnpm --filter @proofhound/web-ui typecheck`
Expected: PASS（空包，绿）。

- [ ] **Step 8：提交**

```bash
git add packages/web tsconfig.base.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "feat(web): 脚手架 @proofhound/web-ui 包 + subpath exports + tsconfig/transpile 接线"
```

### Task 4：`@proofhound/ui` 防环地基（UiStringsContext + 纯 UI hooks）

> 6 个原子件用 `@/i18n`、`sidebar` 用 `@/hooks/use-mobile`。直接搬入 ui 会造 `ui→web` 环。先建注入式字符串契约与纯 hook 落点。

**Files:**
- Create: `packages/ui/src/hooks/use-mobile.ts`（从 `apps/web/src/hooks/use-mobile.tsx` 搬入，无 API 依赖）
- Create: `packages/ui/src/strings/ui-strings-context.tsx`
- Modify: `packages/ui/package.json`（exports 增 `./hooks` `./strings`；deps 增 `lucide-react` 若原子件需要）

- [ ] **Step 1：搬 `use-mobile` 进 ui**

把 `apps/web/src/hooks/use-mobile.tsx` 内容移到 `packages/ui/src/hooks/use-mobile.ts`，导出 `useIsMobile`（保持原签名）。

- [ ] **Step 2：写失败测试 `ui-strings-context`**

`packages/ui/src/strings/ui-strings-context.test.tsx`：
```tsx
import { render, screen } from '@testing-library/react';
import { UiStringsProvider, useUiStrings, DEFAULT_UI_STRINGS } from './ui-strings-context';

function Probe() { return <span>{useUiStrings().tableEmpty}</span>; }

it('默认值无 Provider 时可用', () => {
  render(<Probe />);
  expect(screen.getByText(DEFAULT_UI_STRINGS.tableEmpty)).toBeInTheDocument();
});
it('Provider 覆盖默认值', () => {
  render(<UiStringsProvider value={{ tableEmpty: '空空如也' }}><Probe /></UiStringsProvider>);
  expect(screen.getByText('空空如也')).toBeInTheDocument();
});
```

- [ ] **Step 3：跑测试确认失败**

Run: `pnpm --filter @proofhound/ui test`
Expected: FAIL（模块不存在）。

- [ ] **Step 4：实现 `ui-strings-context.tsx`**

```tsx
'use client';
import { createContext, useContext, type ReactNode } from 'react';

export interface UiStrings {
  tableEmpty: string; tableLoading: string;
  dialogClose: string;
  paginationPrev: string; paginationNext: string;
  imagePreviewClose: string; loaderLabel: string;
  // 收敛自 6 个原子件的全部 t() key —— 实现时逐一对照补齐
}
export const DEFAULT_UI_STRINGS: UiStrings = {
  tableEmpty: 'No data', tableLoading: 'Loading…',
  dialogClose: 'Close', paginationPrev: 'Previous', paginationNext: 'Next',
  imagePreviewClose: 'Close', loaderLabel: 'Loading…',
};
const Ctx = createContext<UiStrings>(DEFAULT_UI_STRINGS);
export function UiStringsProvider({ value, children }: { value: Partial<UiStrings>; children: ReactNode }) {
  return <Ctx.Provider value={{ ...DEFAULT_UI_STRINGS, ...value }}>{children}</Ctx.Provider>;
}
export function useUiStrings(): UiStrings { return useContext(Ctx); }
```

- [ ] **Step 5：跑测试确认通过**

Run: `pnpm --filter @proofhound/ui test` → PASS

- [ ] **Step 6：更新 ui exports + 提交**

`packages/ui/package.json` exports 增 `"./hooks": "./src/hooks/index.ts"`、`"./strings": "./src/strings/index.ts"`（建对应 barrel）；`tsconfig.base.json` 已有 `@proofhound/ui/*` 通配，无需改。
Run: `pnpm --filter @proofhound/ui typecheck` → PASS
```bash
git add packages/ui apps/web/src/hooks/use-mobile.tsx
git commit -m "feat(ui): UiStringsContext 注入式字符串契约 + use-mobile 入 @proofhound/ui（防 ui→web 环）"
```

### Task 5：填实 `@proofhound/ui` 原子件 + `cn` + `Main`

**Files:**
- Create: `packages/ui/src/primitives/*`（搬入 `apps/web/src/components/ui/*` 的 31 个原子件 + 4 个 `.test.ts`）
- Create: `packages/ui/src/lib/utils.ts`（搬入 `apps/web/src/lib/utils.ts` 的 `cn`）
- Create: `packages/ui/src/layout/main.tsx`（搬入 `apps/web/src/components/layout/main.tsx`）
- Modify: `packages/ui/src/index.ts`（删占位，真实 barrel）+ `packages/ui/package.json`（exports `./lib` `./layout`）
- Modify: 6 个 i18n 耦合原子件（`table` `dialog` `table-action` `platform-loader` `resource-pagination-footer` `image-preview-dialog`）：去 `@/i18n`，改用 `useUiStrings()`
- Modify: `sidebar.tsx`：`@/hooks` → `../hooks/use-mobile`
- Modify: apps/web 全量 `@/components/ui` → `@proofhound/ui`、`@/components/layout/main` → `@proofhound/ui/layout`、`@/lib/utils` → `@proofhound/ui`

- [ ] **Step 1：搬原子件 + cn + Main**

`git mv apps/web/src/components/ui/* packages/ui/src/primitives/`；`git mv apps/web/src/lib/utils.ts packages/ui/src/lib/utils.ts`；`git mv apps/web/src/components/layout/main.tsx packages/ui/src/layout/main.tsx`。

- [ ] **Step 2：包内 import 改写（G1）**

primitives 内部互引：`@/components/ui/X` → 相对 `./X`；`@/lib/utils` → `../lib/utils`。`sidebar.tsx` 的 `@/hooks/use-mobile` → `../hooks/use-mobile`。

- [ ] **Step 3：6 个原子件去 i18n**

逐个把 `const { t } = useI18n()` + `t('key')` 改为 `const s = useUiStrings()` + `s.<field>`；对照每个 `t()` 调用补全 `UiStrings` 接口字段与 `DEFAULT_UI_STRINGS`（英文默认）。删除 `@/i18n` import。

- [ ] **Step 4：写 ui barrel**

`packages/ui/src/index.ts` 导出所有 primitives + `cn` + `useIsMobile` + `UiStrings*`；`./layout` barrel 导 `Main`；`./lib` barrel 导 `cn`。`package.json` exports 增 `"./lib"` `"./layout"` `"./primitives"`。

- [ ] **Step 5：repoint apps/web**

apps/web 全量替换：`@/components/ui/<x>` → `@proofhound/ui`（具名）、`@/components/layout/main` → `@proofhound/ui/layout`、`@/lib/utils` → `@proofhound/ui`。

- [ ] **Step 6：Tailwind glob**

确认 `apps/web/tailwind.config.ts` content 含 `../../packages/ui/src/**/*.{ts,tsx}`（已在）。

- [ ] **Step 7：闸门**

Run: `pnpm --filter @proofhound/ui typecheck && pnpm --filter @proofhound/ui test`
Run: `pnpm --filter @proofhound/web-ui... typecheck`（web 仍空，应绿）
Run: `pnpm typecheck`（apps/web 应仍绿——所有 ui import 已重指向）
Expected: 全 PASS。若 apps/web 报 ui 原子件里曾用的 i18n 串现在变默认英文——这些原子件已不在 app 内渲染产品文案；真实本地化在 Task 12 由 `ProofHoundWebProvider` 经 `UiStringsProvider` 注入（见 Task 12 Step）。

- [ ] **Step 8：提交**

```bash
git add packages/ui apps/web
git commit -m "feat(ui): 填实 31 原子件 + cn + Main; 6 件改用 UiStringsContext; apps/web 重指向 @proofhound/ui"
```

### Task 6：api-client 配置接缝（落地 08 §4.1/§4.2）—— TDD

> httpClient 现为裸单例无拦截器。加 `AuthSource` 抽象 + `configureApiClient` + Authorization/X-Project-Id 拦截器。

**Files:**
- Create: `packages/api-client/src/auth-source.ts`（`AuthSource` 抽象 + `LocalAuthSource`）
- Create: `packages/api-client/src/configure.ts`（`configureApiClient`）
- Create: `packages/api-client/src/configure.test.ts`
- Modify: `packages/api-client/src/http.ts`（导出可被配置的 `httpClient`，保留 baseURL 默认）
- Modify: `packages/api-client/src/index.ts`（导出 `AuthSource` `LocalAuthSource` `configureApiClient`）

- [ ] **Step 1：写失败测试 `configure.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { httpClient } from './http';
import { configureApiClient } from './configure';
import { AuthSource } from './auth-source';

class StubAuth extends AuthSource { async getToken() { return 'tok-123'; } }

function lastReqConfig(token: string | null, projectId: string) {
  // 用 axios 请求拦截器 transform 一个假 config
}

describe('configureApiClient', () => {
  beforeEach(() => { httpClient.interceptors.request.clear?.(); });

  it('有 token 时附加 Authorization', async () => {
    configureApiClient({ authSource: new StubAuth(), getProjectId: () => 'p1' });
    const cfg = await runRequestInterceptors(httpClient, { headers: {} });
    expect(cfg.headers.Authorization).toBe('Bearer tok-123');
  });

  it('token 为 null 时不附加 Authorization（OSS）', async () => {
    class NullAuth extends AuthSource { async getToken() { return null; } }
    configureApiClient({ authSource: new NullAuth(), getProjectId: () => 'p1' });
    const cfg = await runRequestInterceptors(httpClient, { headers: {} });
    expect(cfg.headers.Authorization).toBeUndefined();
  });

  it('附加 X-Project-Id', async () => {
    configureApiClient({ authSource: new StubAuth(), getProjectId: () => 'proj-9' });
    const cfg = await runRequestInterceptors(httpClient, { headers: {} });
    expect(cfg.headers['X-Project-Id']).toBe('proj-9');
  });

  it('baseUrl 覆盖', () => {
    configureApiClient({ authSource: new StubAuth(), getProjectId: () => 'p', baseUrl: 'https://x' });
    expect(httpClient.defaults.baseURL).toBe('https://x');
  });
});

// helper: 顺序执行 axios request 拦截器
async function runRequestInterceptors(client: any, config: any) {
  let c = config;
  for (const h of client.interceptors.request.handlers ?? []) {
    if (h?.fulfilled) c = await h.fulfilled(c);
  }
  return c;
}
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @proofhound/api-client test`
Expected: FAIL（`configure`/`auth-source` 不存在）。

- [ ] **Step 3：实现 `auth-source.ts`**

```ts
export abstract class AuthSource {
  /** 返回 Bearer token；OSS 返回 null（浏览器不发凭据，符合 08 §3.2.1 A/B 形态） */
  abstract getToken(): Promise<string | null>;
}
export class LocalAuthSource extends AuthSource {
  async getToken(): Promise<string | null> { return null; }
}
```

- [ ] **Step 4：实现 `configure.ts`**

```ts
import { httpClient } from './http';
import type { AuthSource } from './auth-source';

export interface ApiClientConfig {
  authSource: AuthSource;
  getProjectId: () => string;
  baseUrl?: string;
}
let interceptorId: number | null = null;
export function configureApiClient(config: ApiClientConfig): void {
  if (config.baseUrl) httpClient.defaults.baseURL = config.baseUrl;
  if (interceptorId !== null) httpClient.interceptors.request.eject(interceptorId);
  interceptorId = httpClient.interceptors.request.use(async (req) => {
    const token = await config.authSource.getToken();
    if (token) req.headers.set?.('Authorization', `Bearer ${token}`) ?? (req.headers.Authorization = `Bearer ${token}`);
    const pid = config.getProjectId();
    if (pid) req.headers.set?.('X-Project-Id', pid) ?? (req.headers['X-Project-Id'] = pid);
    return req;
  });
}
```
> 注意 axios v1 的 `AxiosHeaders` API：用 `req.headers.set(...)`；测试 helper 里用普通对象时退化为属性赋值——实现以 axios 实际版本为准（typecheck 兜底）。

- [ ] **Step 5：导出 + 跑测试通过**

`index.ts` 增 `export * from './auth-source'; export * from './configure';`
Run: `pnpm --filter @proofhound/api-client test` → PASS

- [ ] **Step 6：提交**

```bash
git add packages/api-client
git commit -m "feat(api-client): AuthSource + configureApiClient（Authorization/X-Project-Id 拦截器，落地 08 §4.1/§4.2）"
```

### Task 7：搬 `lib/` 域工具进 `@proofhound/web-ui/lib`

**Files:**
- Create: `packages/web/src/lib/*`（`git mv` `apps/web/src/lib/{api-error.ts,format.ts,releases/,project-name.ts,uuid.ts,uuid.test.ts,model-number.ts,model-number.test.ts,model-provider-type.ts,project-context.ts}`）
- Create: `packages/web/src/lib/index.ts`（barrel）
- Modify: 包内 import 改写（G1）；apps/web 残余 `@/lib/X` → `@proofhound/web-ui/lib`

- [ ] **Step 1：搬文件**（`utils.ts` 已在 Task 5 搬去 ui；其余全搬 web/lib）
- [ ] **Step 2：包内改写**：`@/lib/utils`→`@proofhound/ui`；`@proofhound/shared` 不变；`lib/releases/release-line-model.test.ts` 等随搬。
- [ ] **Step 3：barrel** 导出各工具。
- [ ] **Step 4：repoint apps/web** 残余 `@/lib/<x>`（非 utils）→ `@proofhound/web-ui/lib`。
- [ ] **Step 5：闸门**

Run: `pnpm --filter @proofhound/web-ui typecheck && pnpm --filter @proofhound/web-ui test`
Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add packages/web apps/web && git commit -m "refactor(web): lib 域工具迁入 @proofhound/web-ui/lib"
```

### Task 8：搬 i18n + 让 provider 可扩展 —— TDD

**Files:**
- Create: `packages/web/src/i18n/*`（`git mv` `apps/web/src/i18n/{index.tsx,language.ts,language.test.ts}`）
- Modify: `packages/web/src/i18n/index.tsx`（`I18nProvider` 增 `extend` 参数；`t` 合并查找）
- Create: `packages/web/src/i18n/extend.test.tsx`
- Modify: apps/web `@/i18n` → `@proofhound/web-ui/i18n`

- [ ] **Step 1：搬文件**，包内改写（基本无 `@/` 依赖）。
- [ ] **Step 2：写失败测试 `extend.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from './index';

function Probe({ k }: { k: any }) { return <span>{useI18n().t(k)}</span>; }

it('extend 追加的 key 可被 t 解析', () => {
  render(
    <I18nProvider defaultLanguage="en-US" extend={{ 'en-US': { 'saas.org.title': 'Organization' } }}>
      <Probe k={'saas.org.title'} />
    </I18nProvider>,
  );
  expect(screen.getByText('Organization')).toBeInTheDocument();
});
it('extend 不破坏 base key', () => {
  render(<I18nProvider defaultLanguage="en-US" extend={{ 'en-US': { x: 'y' } }}><Probe k={'common.cancel'} /></I18nProvider>);
  expect(screen.getByText(/Cancel/i)).toBeInTheDocument();
});
```

- [ ] **Step 3：跑测试确认失败**（`extend` 未支持）

Run: `pnpm --filter @proofhound/web-ui test` → FAIL

- [ ] **Step 4：实现 extend**

改 `I18nProvider` 签名与 `t`：
```tsx
export function I18nProvider({ children, defaultLanguage = DEFAULT_LANGUAGE, extend }: {
  children: ReactNode; defaultLanguage?: Language;
  extend?: Partial<Record<Language, Record<string, string>>>;
}) {
  /* ...language state 不变... */
  const t = useCallback(
    (key: string) => (extend?.[language]?.[key] ?? (dictionaries[language] as Record<string,string>)[key] ?? key),
    [language, extend],
  );
  /* ... */
}
```
`t` 入参类型放宽为 `WebTranslationKey | (string & {})`（保留对 base key 的自动补全，同时容纳扩展 key）；`useMemo` 依赖加 `extend`。

- [ ] **Step 5：跑测试通过 + repoint apps/web**

Run: `pnpm --filter @proofhound/web-ui test` → PASS
apps/web 残余 `@/i18n` → `@proofhound/web-ui/i18n`（chrome 等也用 i18n，一并改）。

- [ ] **Step 6：闸门 + 提交**

Run: `pnpm typecheck` → PASS
```bash
git add packages/web apps/web && git commit -m "feat(web): i18n 字典+Provider 迁入 @proofhound/web-ui/i18n; Provider 支持 extend"
```

### Task 9：搬 hooks 进 `@proofhound/web-ui/hooks`

**Files:**
- Create: `packages/web/src/hooks/*`（`git mv` 17 域 hooks + `use-auto-refresh` + `use-delayed-loading` + 各 `.test.ts`；`use-mobile` 已去 ui）
- Create: `packages/web/src/hooks/index.ts`（barrel）
- Modify: 包内改写（G1：`@/i18n`→`../i18n`、`@/lib/X`→`../lib/X`、`@proofhound/api-client`/`shared` 不变）；apps/web `@/hooks` → `@proofhound/web-ui/hooks`

- [ ] **Step 1：搬文件 + 包内改写。** `use-mobile` 的引用者改 `@proofhound/ui`。
- [ ] **Step 2：barrel 导出全部 hooks。**
- [ ] **Step 3：repoint apps/web** `@/hooks/<x>` → `@proofhound/web-ui/hooks`。
- [ ] **Step 4：闸门**

Run: `pnpm --filter @proofhound/web-ui typecheck && pnpm --filter @proofhound/web-ui test`（含 `optimization.test.ts`、`use-auto-refresh.test.ts`、`use-delayed-loading.test.ts`）
Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/web apps/web && git commit -m "refactor(web): 20 hooks 迁入 @proofhound/web-ui/hooks"
```

### Task 10：搬产品域组件 + features 进 `@proofhound/web-ui/components`

**Files:**
- Create: `packages/web/src/components/*`（`git mv` `apps/web/src/components` 下除 `ui/`(已搬)、`layout/`(留app) 外的全部：`annotations/` `brand/` `charts/` `prompt-diff/` `quick-fill/` 及顶层 `json-object-textarea.tsx` `model-context-window-input.tsx` `model-probe-status.tsx` `prompt-language-select.tsx` `prompt-version-picker-row.tsx` `prompt-version-status-badge.tsx`，含 `prompt-diff-split-view.test.ts`）
- Create: `packages/web/src/features/*`（`git mv` `apps/web/src/features/model-quick-fill/*` 含 `model-preset-draft.test.ts`）
- Create: `packages/web/src/components/index.ts`、`packages/web/src/features/index.ts`（barrel）
- Modify: 包内改写（G1）；apps/web `@/components/<x>`（产品域）、`@/features` → `@proofhound/web-ui/components`|`@proofhound/web-ui`

> 注：`brand/proofhound-logo.tsx` 是纯品牌 SVG——也可放 ui；但 OSS chrome（not-found/global-error）也用它。为避免 chrome→web 依赖，**把 `proofhound-logo` 放 `@proofhound/ui`**（纯展示，零业务），其余产品域组件放 web。执行时据实判断每个组件的耦合：纯展示→ui，含 i18n/shared/hooks→web。

- [ ] **Step 1：分流搬迁**：`proofhound-logo` → `packages/ui/src/primitives/`（或 `brand/`）；其余 → `packages/web/src/components/`。features 全搬 web。
- [ ] **Step 2：包内改写（G1）**：`@/components/ui`→`@proofhound/ui`、`@/i18n`→`../i18n`、`@/hooks`→`../hooks`、`@/lib/X`→`../lib/X`、`@proofhound/shared` 不变。
- [ ] **Step 3：barrel。**
- [ ] **Step 4：repoint apps/web**（chrome 若用了 `proofhound-logo` 改 `@proofhound/ui`；其余产品域组件引用改 `@proofhound/web-ui/components`）。
- [ ] **Step 5：闸门**

Run: `pnpm --filter @proofhound/ui test && pnpm --filter @proofhound/web-ui typecheck && pnpm --filter @proofhound/web-ui test && pnpm typecheck`
Expected: PASS（含 `prompt-diff-split-view.test.ts`、`model-preset-draft.test.ts`）。

- [ ] **Step 6：提交**

```bash
git add packages/ui packages/web apps/web && git commit -m "refactor(web): 产品域组件+features 迁入 @proofhound/web-ui; proofhound-logo 入 ui"
```

### Task 11：搬屏体进 `@proofhound/web-ui/screens`

> 24 个 `_components/*-page.tsx` + 胖 `dashboard/page.tsx`（903 行）。这是最大批次。

**Files:**
- Create: `packages/web/src/screens/<resource>/*`（按资源分目录搬入屏体及其同目录测试/helper）
- Create: `packages/web/src/screens/index.ts`（barrel，导出 `*Screen`）
- Modify: 包内改写（G1）；屏体的 `Main` 引用已是 `@proofhound/ui/layout`

搬迁映射（屏体 → screens 目录，导出名按 `*Screen` 命名以区别"路由 page"）：

| 源（apps/web/src/app/...） | 目标（packages/web/src/screens/...） | 导出 |
|---|---|---|
| `annotations/_components/*-page.tsx` (+测试) | `annotations/` | `AnnotationsListScreen` / `AnnotationDetailScreen` / `AnnotationNewScreen` |
| `connectors/_components/*` | `connectors/` | `ConnectorsListScreen` / `ConnectorDetailScreen` / `ConnectorFormScreen` |
| `datasets/_components/*` (+`__tests__`,helpers) | `datasets/` | `DatasetsListScreen` / `DatasetDetailScreen` / `DatasetUploadScreen` |
| `experiments/_components/*`,`experiments/[experimentId]/_components/*`,`experiments/new/_components/*` (+测试) | `experiments/` | `ExperimentsListScreen` / `ExperimentDetailScreen` / `ExperimentNewScreen` |
| `models/_components/*` | `models/` | `ModelsListScreen` / `ModelFormScreen` |
| `monitoring/_components/project-monitoring-page.tsx` | `monitoring/` | `ProjectMonitoringScreen` |
| `optimizations/_components/*`,`optimizations/[optimizationId]/_components/*`,`optimizations/new/_components/*` (+`__tests__`) | `optimizations/` | `OptimizationsListScreen` / `OptimizationDetailScreen` / `OptimizationNewScreen` |
| `prompts/_components/*` (+测试) | `prompts/` | `PromptsListScreen` / `PromptDetailScreen` |
| `releases/_components/*` (+测试) | `releases/` | `ReleasesListScreen` / `ReleaseLineDetailScreen` / `ReleaseNewScreen` |
| `settings/_components/settings-page.tsx` | `settings/` | `SettingsScreen` |
| `dashboard/page.tsx`（胖页，拆出屏体） | `dashboard/` | `DashboardScreen` |
| `quick-start/page.tsx`（胖页，拆出屏体） | `quick-start/` | `QuickStartScreen` |
| `comparisons/page.tsx`（若有屏体逻辑） | `comparisons/` | `ComparisonsScreen` |

> `dashboard`/`quick-start`/`comparisons` 当前逻辑在 `page.tsx` 内联。搬迁时把页面**主体**抽成 `*Screen` 组件移入 web，`apps/web` 的 `page.tsx` 退成瘦包装（Task 13 统一处理）。canary-releases / production-releases 的列表/详情若也有屏体，照同法（执行时按 `find _components` 实际清单补全；本表覆盖已知 24 个 `*-page.tsx`）。

- [ ] **Step 1：按表 `git mv` 屏体 + 同目录测试/helper 到 `screens/<resource>/`。**
- [ ] **Step 2：把组件改名/具名导出为 `*Screen`**（原文件多为 `export function XxxPage(...)`；重命名为 `XxxScreen` 并更新 barrel；若被同包其它文件引用一并改）。
- [ ] **Step 3：包内改写（G1）**：`@/components/ui`→`@proofhound/ui`、`@/components/layout/main`→`@proofhound/ui/layout`、`@/components/<产品域>`→`../../components/<x>`、`@/hooks`→`../../hooks`、`@/i18n`→`../../i18n`、`@/lib/X`→`../../lib/X`、`@/providers`→`../../providers`（providers 在 Task 12 搬入；此刻可能尚未到位——若屏体用 `useProjectContext`，先临时从 `../../providers` 引，Task 12 落地）。`next/navigation`、`@proofhound/shared`/`api-client` 不变。
- [ ] **Step 4：barrel** `screens/index.ts` 导出全部 `*Screen`。
- [ ] **Step 5：闸门**

Run: `pnpm --filter @proofhound/web-ui typecheck`
Expected: 仅剩对 `providers`（Task 12）的未决引用；其余 PASS。`pnpm --filter @proofhound/web-ui test`（屏体级测试如 `prompt-preview.test.ts`、`dataset-mappers.test.ts`、`run-result-display.test.ts`、`optimization-mappers.spec.ts` 等）应 PASS。

- [ ] **Step 6：提交**

```bash
git add packages/web apps/web && git commit -m "refactor(web): 24+ 屏体迁入 @proofhound/web-ui/screens（*Screen）"
```

### Task 12：providers + contracts + `ProofHoundWebProvider` —— TDD

**Files:**
- Create: `packages/web/src/providers/*`（`git mv` `apps/web/src/providers/{refine-provider.tsx,project-context-provider.tsx}`；`apps/web/src/lib/project-context.ts` 已在 Task 7 搬入 web/lib）
- Create: `packages/web/src/contracts/index.ts`（`WebContracts` + `localWebContracts`）
- Create: `packages/web/src/providers/proofhound-web-provider.tsx`
- Create: `packages/web/src/providers/proofhound-web-provider.test.tsx`
- Modify: `project-context-provider.tsx` 改为接受注入的 `projectContext`（不再写死 `resolveProjectContext()`）

- [ ] **Step 1：搬 providers + 改 ProjectContextProvider 为可注入**

```tsx
// project-context-provider.tsx
export function ProjectContextProvider({ value, children }: { value: ProjectContext; children: ReactNode }) {
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}
// useProjectContext 不变
```

- [ ] **Step 2：写 contracts**

```tsx
// contracts/index.ts
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { AuthSource, LocalAuthSource } from '@proofhound/api-client';
import type { Language } from '../i18n';

export interface WebContracts {
  authSource: AuthSource;
  projectContext: ProjectContext;            // SaaS 可传响应式源（见下注）
  baseUrl?: string;
  i18nExtend?: Partial<Record<Language, Record<string, string>>>;
}
export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};
```
> SaaS 多租户运行时切项目：可把 `projectContext` 设计成 `ProjectContext | (() => ProjectContext)`，`ProofHoundWebProvider` 内用 `useSyncExternalStore`/状态订阅。OSS 用常量即可。本任务先支持常量；响应式源作为 `WebContracts` 的兼容扩展点留注释。

- [ ] **Step 3：写失败测试 `proofhound-web-provider.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { ProofHoundWebProvider } from './proofhound-web-provider';
import { localWebContracts } from '../contracts';
import { useProjectContext } from './project-context-provider';
import { useI18n } from '../i18n';

function Probe() {
  return <><span data-testid="pid">{useProjectContext().projectId}</span>
    <span data-testid="t">{useI18n().t('common.cancel')}</span></>;
}

it('注入 projectContext + i18n', () => {
  render(<ProofHoundWebProvider contracts={localWebContracts}><Probe /></ProofHoundWebProvider>);
  expect(screen.getByTestId('pid').textContent).toBe(localWebContracts.projectContext.projectId);
  expect(screen.getByTestId('t').textContent).toBeTruthy();
});
```

- [ ] **Step 4：跑测试确认失败**

Run: `pnpm --filter @proofhound/web-ui test` → FAIL（provider 不存在）。

- [ ] **Step 5：实现 `proofhound-web-provider.tsx`**

```tsx
'use client';
import { type ReactNode, useEffect } from 'react';
import { configureApiClient } from '@proofhound/api-client';
import { UiStringsProvider } from '@proofhound/ui/strings';
import { I18nProvider, useI18n } from '../i18n';
import { ProjectContextProvider } from './project-context-provider';
import { RefineProvider } from './refine-provider';
import type { WebContracts } from '../contracts';

export function ProofHoundWebProvider({ contracts, children }: { contracts: WebContracts; children: ReactNode }) {
  useEffect(() => {
    configureApiClient({
      authSource: contracts.authSource,
      getProjectId: () => contracts.projectContext.projectId,
      baseUrl: contracts.baseUrl,
    });
  }, [contracts]);
  return (
    <I18nProvider extend={contracts.i18nExtend}>
      <UiStringsBridge>
        <ProjectContextProvider value={contracts.projectContext}>
          <RefineProvider>{children}</RefineProvider>
        </ProjectContextProvider>
      </UiStringsBridge>
    </I18nProvider>
  );
}

// 把 i18n 的 t() 桥接进 @proofhound/ui 的 UiStringsContext（消除 ui→web 依赖，注入本地化串）
function UiStringsBridge({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <UiStringsProvider value={{
    tableEmpty: t('common.table.empty'), tableLoading: t('common.table.loading'),
    dialogClose: t('common.close'), paginationPrev: t('common.prev'), paginationNext: t('common.next'),
    imagePreviewClose: t('common.close'), loaderLabel: t('common.loading'),
    // 与 Task 4 的 UiStrings 字段一一对应；key 用原 6 件里真实的 i18n key
  }}>{children}</UiStringsProvider>;
}
```
> `configureApiClient` 放 `useEffect`（client-only，避免 SSR 期写全局单例）。`UiStringsBridge` 用 i18n 真实 key 填充——把 Task 4 里临时英文默认替换为本地化值，且依赖方向仍是 `web→ui`（ui 只定义 context，不引 web）。

- [ ] **Step 6：跑测试通过**

Run: `pnpm --filter @proofhound/web-ui test` → PASS

- [ ] **Step 7：barrel + 闸门**

`providers/index.ts` 导出 `ProofHoundWebProvider`、`useProjectContext`（透传）、（如需）`RefineProvider`。
Run: `pnpm --filter @proofhound/web-ui typecheck && pnpm --filter @proofhound/web-ui test`（Task 11 遗留的 providers 引用此刻应消解）
Expected: PASS。

- [ ] **Step 8：提交**

```bash
git add packages/web && git commit -m "feat(web): ProofHoundWebProvider + WebContracts/localWebContracts（web 版 forRoot 接缝）+ UiStrings 桥接"
```

### Task 13：`apps/web` 退薄壳（路由瘦包装 + layout + globals.css）

**Files:**
- Modify: `apps/web/src/app/**/page.tsx`（37 个瘦包装：import `@proofhound/web-ui/screens`；胖 `dashboard`/`quick-start`/`comparisons` 退成瘦包装）
- Modify: `apps/web/src/app/layout.tsx`（用 `<ProofHoundWebProvider contracts={localWebContracts}>` 替换 `I18nProvider`+`ProjectContextProvider`+`RefineProvider` 三层；保留 `AppShell` chrome）
- Move: `apps/web/src/styles/globals.css` → `packages/web/src/styles/globals.css`；apps/web 全局 css `@import '@proofhound/web-ui/styles/globals.css'`
- Modify: `apps/web/tailwind.config.ts`（content 增 `../../packages/web/src/**/*.{ts,tsx}`）
- Modify: `apps/web/src/app/{loading,not-found,global-error}.tsx`、`api/sse`（若引已搬符号，重指向；chrome/品牌引用改 `@proofhound/ui`/`@proofhound/web-ui`）
- Delete: 已空的 `apps/web/src/{hooks,i18n,providers,features}` 残余目录、`app/**/_components`（屏体已搬）

- [ ] **Step 1：改 `layout.tsx`**

```tsx
import { ProofHoundWebProvider } from '@proofhound/web-ui/providers';
import { localWebContracts } from '@proofhound/web-ui/contracts';
// ...保留 AppShell、字体、beforeInteractive theme 脚本、defaultLanguage 解析...
<ProofHoundWebProvider contracts={localWebContracts}>
  <AppShell>{children}</AppShell>
</ProofHoundWebProvider>
```
> 若 `layout.tsx` 原先在服务端解析 `defaultLanguage`（accept-language），把该值经 `ProofHoundWebProvider` 透传到内部 `I18nProvider`（给 contracts 加可选 `defaultLanguage` 或包一层）。

- [ ] **Step 2：改 37 个 `page.tsx` 为瘦包装**

每个形如：
```tsx
// apps/web/src/app/datasets/page.tsx
'use client';
import { DatasetsListScreen } from '@proofhound/web-ui/screens';
import { useProjectContext } from '@proofhound/web-ui/providers';
export default function Page() { const { projectId } = useProjectContext(); return <DatasetsListScreen projectId={projectId} />; }
```
动态路由保留原 `useParams` 解析，把参数透传给 `*Screen`（保持各屏体原 props 契约）。`dashboard`/`quick-start`/`comparisons` 同法瘦化。

- [ ] **Step 3：globals.css 搬迁 + tailwind glob**

`git mv apps/web/src/styles/globals.css packages/web/src/styles/globals.css`；apps/web 入口 css（原 import globals 处）改 `@import '@proofhound/web-ui/styles/globals.css';`；`apps/web/tailwind.config.ts` content 增 web 包 glob。

- [ ] **Step 4：清理空目录**

确认 `apps/web/src/{hooks,i18n,providers,features}` 与各 `app/**/_components` 已无残留文件后删除。`apps/web/src/components/layout/` 保留（chrome）。

- [ ] **Step 5：闸门（含构建）**

Run: `pnpm typecheck`
Run: `pnpm --filter @proofhound/web-ui... build`（或 `pnpm --filter web build` 跑 Next 构建，确认 transpilePackages + CSS 解析）
Expected: PASS（Next 构建成功；无 `@/...` 残留指向已搬模块）。

- [ ] **Step 6：提交**

```bash
git add apps/web packages/web && git commit -m "refactor(web): apps/web 退薄壳（路由瘦包装+ProofHoundWebProvider+globals.css 迁移；chrome 留存）"
```

### Task 14：最终闸门（ci + madge + e2e）

**Files:** 无（验证 + 收尾）

- [ ] **Step 1：环依赖**

Run: `pnpm deps:check`
Expected: 无新增环。**特别确认无 `@proofhound/ui → @proofhound/web-ui` 边**（UiStringsContext 设计即为此；若报环，回查是否有原子件残留 `@/i18n`/`@proofhound/web-ui` 引用）。

- [ ] **Step 2：全闸门**

Run: `pnpm run ci`（typecheck + lint + test + deps:check + spec:terms）
Expected: 全绿。（注意用 `pnpm run ci`，非 `pnpm ci`。）

- [ ] **Step 3：e2e（需服务）**

按 CLAUDE.md #17：**不自行起服务**。请 ZiqiXiao 切到含 `test/full-e2e-suite` 的工作区起 `pnpm dev`（web :3000），或在已运行的实例上跑功能级 e2e（假 LLM 桩 + 真 worker）。
Expected: 关键产品流（dataset 上传→optimization→experiment→release、prompt 版本、annotation、connector）冒烟通过。

- [ ] **Step 4：交付说明 + 收尾提交**

若某闸门项未跑（如 e2e 依赖服务未起），按 DoD 在 PR 描述里写明哪些未跑及原因。
```bash
git add -A && git commit -m "chore(web): 抽离收尾——pnpm run ci 全绿; 交付说明"
```

---

## 自审（Self-Review）

**1. Spec 覆盖：**
- 08 §4 重写 → Task 1 ✓；07 §7/§8 + §6.13 → Task 2 ✓
- D1 单包 + subpath exports → Task 3 ✓
- D1 填实 ui（31 原子件 + cn + Main） → Task 5 ✓；`use-mobile`/logo 入 ui → Task 4/10 ✓
- D2 chrome 留 app → Task 13（保留 `components/layout`）✓
- D3 ProofHoundWebProvider + WebContracts + localWebContracts → Task 12 ✓
- D4 i18n 整字典进包 + extend → Task 8 ✓
- D5 PR-web-1 spec 先行 + PR-web-2 大抽离 → 两段结构 ✓
- 设计 §5「api-client 配置接缝落地 08 §4.1/§4.2」 → Task 6 ✓
- 设计 §11「防 ui→web 环」 → Task 4 + Task 14 Step 1 ✓
- hooks/components/screens/lib 迁移 → Task 7/9/10/11 ✓；globals.css/tailwind → Task 13 ✓；测试随搬 → 各任务 test 步 ✓

**2. 占位扫描：** 无 TODO/TBD 作为可交付内容；"按实际清单补全"处均给了已知全量清单 + 补全判据（canary/production-releases 屏体执行时据 `find` 补，已注明）。

**3. 类型一致性：** `AuthSource.getToken(): Promise<string|null>`（Task 6）↔ `LocalAuthSource`（Task 6/12）↔ `WebContracts.authSource`（Task 12）一致；`configureApiClient({authSource, getProjectId, baseUrl})`（Task 6）↔ `ProofHoundWebProvider` 调用（Task 12）一致；`UiStrings` 字段（Task 4）↔ `UiStringsBridge` 填充（Task 12）需逐字段对齐（Task 12 Step 5 已注明"与 Task 4 字段一一对应"）；`I18nProvider({extend})`（Task 8）↔ `ProofHoundWebProvider`（Task 12）一致；`*Screen` 导出名（Task 11 表）↔ apps/web 瘦包装 import（Task 13）一致。

**风险复述：** 最大不确定性在 Task 11（屏体级 import 改写量大）与 Task 14 Step 1（环依赖）；两者都有增量 typecheck/madge 兜底。屏体 props 契约保持不变以最小化 apps/web 改动。
