# Hako 前端

Hako 的独立全屏界面，由路由器在 `/hako/` 提供，经 `/ubus` 调用 rpcd。

- 技术栈：Vite、React、TypeScript、TanStack Router（hash 路由）、TanStack Query、Tailwind v4、shadcn/ui（Base UI，vega 风格）、ReUI。
- 组件用 shadcn 和 ReUI 的默认组件，加进项目后不改源码；颜色来自设计系统，写在 `src/index.css`。

## 开发

```sh
pnpm install
HAKO_ROUTER=http://127.0.0.1:18081 pnpm dev
```

`HAKO_ROUTER` 是开发时 `/ubus` 转发到的路由器，默认 `http://127.0.0.1:18081`（测试容器的 LuCI 经 ssh 隧道）。不要指向正在使用的路由器。

## 构建

```sh
pnpm build
```

产物输出到 `../luci-app-hako/htdocs/hako/`，随 luci-app-hako 安装到 `/www/hako/`。构建产物不进 git。

## 目录

- `src/lib/ubus.ts`：ubus JSON-RPC、登录和会话
- `src/lib/uci.ts`：读写 UCI，应用时带回滚和确认
- `src/lib/hako.ts`：luci.hako 的接口
- `src/router.tsx`：路由，未登录跳到登录页
- `src/components/app-shell.tsx`：侧边栏和页面框架
- `src/pages/`：各页面；还没迁移的页面链接到 LuCI 的对应页
