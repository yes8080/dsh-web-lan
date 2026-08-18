# dsh-web-lan

让 DeepSeek Harness (`dsh`) 通过局域网被访问：一条命令安装，默认密码 `123`，
无需修改任何配置文件。

LAN access layer for DeepSeek Harness (`dsh`): one-command install, default
password `123`, no config editing required.

## 功能 / Features

1. **`crypto.randomUUID` 补丁** — 修复明文 HTTP 局域网（非安全上下文）下
   `crypto.randomUUID is not a function` 导致的整个 `/api` 层失败；
   Patches the missing `crypto.randomUUID` on plain-HTTP LAN origins.
2. **密码登录门** — 未登录只能看到登录页（API/WebSocket 直接 401/断开）；
   登录后以回环身份进入 dsh，设置/凭据/Agent 预设等"仅限本机"功能全部可用；
   Password gate — unauthenticated callers only see the login page; logged-in
   LAN users get full access (settings, credentials, agent presets).
3. **客户端 `isLoopback` 补丁** — 修复局域网页面"设置 → 插件配置"空白；
   Fixes the blank 插件配置 tab on LAN pages.
4. **设置页管理密码** — 设置 → 插件 → 插件配置 的 **局域网访问** 卡片可
   直接改密码，立即生效并持久化；中英文跟随通用设置语言自动切换；
   Manage the password from the settings page (zh/en follows the General
   settings language).

## 快速开始 / Quick Start

```bash
dsh plugin --profile web add 'git+https://github.com/yes8080/dsh-web-lan.git'
npm exec @deepseek-ai/dsh web   # 重启 / restart
```

完成。启动后终端打印 `LAN: http://<ip>:3080`，局域网用户访问该地址，
用密码 **`123`** 登录（首次登录后请尽快在设置页修改）。

That's it. After restart, LAN users open `http://<ip>:3080` and sign in with
password **`123`** (change it as soon as possible from the settings page).

> 需要 pnpm：`corepack enable pnpm`（若未启用）。

## 密码 / Password

- 默认 `123`；安装/启动前可用环境变量覆盖：`export DSH_LAN_PASSWORD='强密码'`；
- 登录后：设置 → 插件 → 插件配置 → **局域网访问** 卡片修改（立即生效、
  写入 `~/.dsh/settings.yaml` 持久化）；
- 高级用户可在 `~/.dsh/profiles/web/cordis.patch.yml` 显式覆盖（用户层晚于
  插件 bundle 层生效）。

## 工作原理 / How it works

- 包装 `webServer` 的 node:http 处理：未登录 → 登录页 / 401；已登录 →
  把 `Host`/`Origin` 改写为回环地址，使 dsh 的信任栅栏把局域网用户当作
  本机客户端（单共享密码，无多用户）；
- 会话 Cookie（`dsh_lan_session`，HttpOnly + SameSite=Strict）持久化到
  `~/.dsh/dsh-lan-sessions.json`，重启不踢人；每 IP 连续 5 次失败锁定 30 秒；
- 拦截浏览器实际加载的 `dsh-client-connection` bundle，把 `isLoopback`
  强制为 `true`（**fail-safe**：精确匹配标记串才替换，升级不破坏）；
- 向 `settings` 服务注册 `lan-access` 命名空间（密码字段 `role('secret')`，
  任何响应都不携带明文），监听变更并同步到登录门。

## 安全 / Security

- **默认密码 `123` 是公开的** —— 安装后请立即修改或设置环境变量；
- 密码在局域网内明文传输（HTTP），敏感环境请用 SSH 隧道或 HTTPS；
- 只在可信的主机名/IP 上登录（DNS rebinding）；
- 登录后拥有完整权限（含可执行命令的 agent 工具）。

## 卸载 / Uninstall

```bash
dsh plugin --profile web remove dsh-web-lan
# 重启 dsh 生效
npm exec @deepseek-ai/dsh web
```

卸载后自动恢复：webserver 监听回到默认 `127.0.0.1`（局域网访问关闭）、
`lan-access` 行/登录门/浏览器卡片全部移除，**不影响其他插件**（插件只包装
webserver 请求处理并注册自己的设置命名空间，卸载即还原）。可选清理残留数据：

```bash
# 删除设置文档中的 lan-access 段（如曾在页面改过密码）
# 编辑 ~/.dsh/settings.yaml，删除 lan-access: 段
# 删除登录会话文件（让旧会话令牌全部失效）
rm ~/.dsh/dsh-lan-sessions.json
```

## 开发 / Development

```bash
dsh plugin --profile web add /path/to/dsh-web-lan   # 本地软链安装
npm install                                          # 安装依赖（dsh-settings、schemastery）
node test/integration.test.mjs                       # 纯 Node 集成测试
```

## 许可 / License

MIT
