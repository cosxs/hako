# Hako 实现进度

记录 Hako 已经实现了什么。配置按 sing-box 文档的结构对照，界面分新界面（`/hako/`）和旧 LuCI 两套。

状态的含义：

- **已实现**：功能完整可用。
- **部分实现**：能用，但有缺口，缺口写在说明里。
- **未实现**：计划要做，还没有做。
- **不做**：有意不支持，原因写在说明里。

「生成器」指 `generate.uc` 能把这项写进 sing-box 配置；「界面」指能在页面上编辑。生成器支持、界面没有的项，可以手写 UCI 使用。

## 1. sing-box 配置

### 1.1 日志 [`log`](https://sing-box.sagernet.org/zh/configuration/log/)

**已实现。**

| 字段 | 生成器 | 新界面 | 说明 |
| --- | --- | --- | --- |
| `disabled` | 支持 | 内核设置 › 日志 | |
| `level` | 支持 | 内核设置 › 日志 | |
| `timestamp` | 支持 | 内核设置 › 日志 | |
| `output` | 支持 | 不做 | 内核日志由 Hako 写入 `/var/log/hako/core.log`，日志页读取和按天轮转都依赖它；设了 `output` 之后 sing-box 不再输出到控制台 |

### 1.2 DNS [`dns`](https://sing-box.sagernet.org/zh/configuration/dns/)

**部分实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `final`、`strategy`、`optimistic` | 已实现 | 内核设置 › DNS |
| `disable_cache`、`disable_expire`、`cache_capacity`、`timeout`、`reverse_mapping`、`client_subnet` | 部分实现 | 生成器支持，两套界面都没有 |
| DNS 服务器：`udp`、`tcp`、`tls`、`quic`、`https`、`h3`、`local`、`fakeip` | 部分实现 | 内核设置 › DNS 的表格里增删改，弹窗左边是服务器、右边是拨号字段（出站、域名解析）。`local` 和 `fakeip` 内置，不在表格里：`fakeip` 由 FakeIP 卡片的开关添加，地址段也在那里改。界面不能编辑 `tls_insecure`（生成器支持）和 `local` 的 `prefer_go`（生成器支持） |
| DNS 服务器：`dhcp`、`hosts`、`resolved`、`tailscale` 等其他类型 | 未实现 | 生成器会跳过并给出警告 |
| DNS 规则 | 部分实现 | 模板自带的规则（局域网域名交给 dnsmasq、国内外分流）是固定的，只有境外域名交给谁可以改：FakeIP 开着时交给 `fakeip`，关掉时交给「境外 DNS 服务器」；自定义规则只能在内核设置 › DNS 里写 JSON，没有可视化编辑 |

### 1.3 NTP [`ntp`](https://sing-box.sagernet.org/zh/configuration/ntp/)

**已实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `enabled`、`server`、`server_port`、`interval` | 已实现 | 内核设置 › NTP |
| 拨号字段 | 已实现 | 「拨号字段」一行的「配置…」打开弹窗，写 JSON；生成器把它合到 `ntp` 里。旧的单独选项 `detour`、`domain_resolver` 生成器仍然支持，保存时原样保留 |

### 1.4 证书 [`certificate`](https://sing-box.sagernet.org/zh/configuration/certificate/)

**未实现。**

### 1.5 端点 [`endpoints`](https://sing-box.sagernet.org/zh/configuration/endpoint/)

**部分实现。** 订阅里的 endpoint 节点（如 WireGuard）照常使用；不能手动添加 endpoint。

### 1.6 入站 [`inbounds`](https://sing-box.sagernet.org/zh/configuration/inbound/)

**部分实现。** 入站由「接管」决定，不能任意添加。

| 入站 | 状态 | 说明 |
| --- | --- | --- |
| `tun` | 已实现 | 接管方式 TUN：`auto_route` + `auto_redirect`，接口名、地址、MTU、绕过的地址和规则集 |
| `tproxy` | 已实现 | 接管方式 TProxy，防火墙规则由 Hako 设置（见 2.3） |
| `direct`（`dns-in`） | 已实现 | DNS 入站，防火墙把局域网的 DNS 查询（包括发给路由器的）重定向到它 |
| `mixed` | 已实现 | 代理端口，可设用户名和密码 |
| `redirect` 和其他入站 | 不做 | M1 不做 redirect 接管 |

### 1.7 出站 [`outbounds`](https://sing-box.sagernet.org/zh/configuration/outbound/)

**已实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 节点协议：Shadowsocks、VMess、VLESS（含 Reality）、Trojan、Hysteria2（可端口跳跃）、TUIC、AnyTLS、NaiveProxy、Snell、SSH、SOCKS、HTTP | 已实现 | 策略页的节点弹窗；拨号字段写 JSON，前置节点（`detour`）也写在这里 |
| 策略组 `selector`、`urltest` | 已实现 | 策略页 |
| `direct` | 已实现 | 模板自带 |
| Hysteria v1、ShadowTLS（手动添加）、WireGuard（手动添加）、Tor | 不做 | 见设计文档 M1 的节点一节 |

### 1.8 路由 [`route`](https://sing-box.sagernet.org/zh/configuration/route/)

**部分实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `final`、`find_neighbor`、`dhcp_lease_files`、`default_http_client`、`default_domain_resolver` | 已实现 | 规则 › 设置 |
| `auto_detect_interface` | 已实现 | 生成器总是开启，不在界面上 |
| `default_mark` | 已实现 | TProxy 时由 Hako 设置为 `firewall.output_mark` |
| `default_interface`、`find_process`、`default_network_strategy` 等多网卡策略 | 不做 | 设计文档里不列出 |
| 路由规则：匹配条件 | 部分实现 | 支持 `domain` 系列、`ip_cidr`、`ip_is_private`、`source_ip_cidr`、`source_ip_is_private`、`source_mac_address`、`source_hostname`、`port`、`port_range`、`source_port`、`source_port_range`、`network`、`protocol`、`ip_version`、`inbound`、`auth_user`、`rule_set`、`rule_set_ip_cidr_match_source`、`clash_mode`、`invert`。其他条件（如 `process_name`、`wifi_ssid`、`package_name`）未实现 |
| 路由规则：逻辑规则 `and` / `or` | 已实现 | 子规则可以写 JSON |
| 规则动作：`route`、`reject`（`method`） | 已实现 | |
| 规则动作：`reject` 的 `no_drop` | 部分实现 | 生成器支持，界面没有 |
| 规则动作：`sniff`、`hijack-dns` | 部分实现 | 只用在模板自带的隐藏规则里，界面不能添加 |
| 规则动作：`route-options`、`resolve`、`bypass` 等 | 未实现 | |

### 1.9 规则集 [`rule_set`](https://sing-box.sagernet.org/zh/configuration/rule-set/)

**已实现。** 远程、本地、内联三种都可以在规则 › 规则集里增删改。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `tag`、`type`、`format`、`url`、`path`、`rules`、`update_interval`、`http_client` | 已实现 | |
| `initial_path` | 部分实现 | 生成器支持，编辑时原样保留，界面没有字段 |
| 国内 IP 规则集 `geoip-cn` | 已实现 | SagerNet/sing-geoip 的远程规则集，随包附带 CI 打包时的最新版作为 `initial_path`，由 sing-box 自动更新 |

### 1.10 HTTP 客户端 [`http_clients`](https://sing-box.sagernet.org/zh/configuration/shared/http-client/)

**部分实现。** 内核设置 › HTTP 客户端可以增删改。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `tag`、`version`、`disable_version_fallback`、`headers`、出站（拨号字段 `detour`） | 已实现 | |
| HTTP2 / QUIC 调优字段、TLS 字段、其他拨号字段 | 部分实现 | 只有旧 LuCI 能编辑；新界面保存时原样保留 |

### 1.11 服务 [`services`](https://sing-box.sagernet.org/zh/configuration/service/)

**部分实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `api`：监听、端口、密钥、允许的来源、允许私有网络、面板 | 已实现 | 内核设置 › API |
| `api` 的 TLS 字段和更多字段 JSON | 部分实现 | 只有旧 LuCI 能编辑；新界面保存时原样保留 |
| 其他服务（DERP、resolved、ssm-api 等） | 未实现 | |

### 1.12 实验性 [`experimental`](https://sing-box.sagernet.org/zh/configuration/experimental/)

**部分实现。**

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `cache_file`：`enabled`、`path`、`cache_id`、`store_fakeip`、`store_dns` | 已实现 | 内核设置 › 实验性 |
| `clash_api`：监听地址、密钥、面板目录、下载地址、下载出站、允许私有网络 | 已实现 | 内核设置 › 实验性 |
| `clash_api`：`default_mode` | 已实现 | 由出站模式切换设置，不在内核设置里 |
| `clash_api`：`access_control_allow_origin` | 部分实现 | 只有旧 LuCI 能编辑 |
| `v2ray_api` | 未实现 | |

## 2. Hako 自己的功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 运行 | 已实现 | procd 托管 sing-box，崩溃后自动拉起；启动前 `sing-box check`，不通过不启动；重载失败保留旧配置 |
| 内核安装 | 部分实现 | 从 GitHub 安装最新版或上传官方 apk，只在旧 LuCI 活动页 |
| 查看生成的配置 | 已实现 | 新界面配置文件页点配置名或「更多 › 查看」，只读显示生成的 JSON 和生成器的警告 |
| 出站模式 | 已实现 | 规则判定 / 全局代理 / 直接连接，在新界面策略页切换 |
| 透明代理（TUN / TProxy） | 已实现 | 新界面接管页：接管开关和方式、DNS 端口，TUN 的接口名、地址、MTU、绕过的规则集和地址，TProxy 的端口、局域网接口和绕过的地址 |
| TProxy 防火墙 | 已实现 | `firewall.uc` 生成 nftables 规则和策略路由；只绕过保留地址，规则集交给 sing-box 匹配 |
| DNS 接管 | 已实现 | 防火墙把局域网的 DNS 查询和路由器本机发往 dnsmasq 的查询重定向到 `dns-in`（本机这部分 TUN 需开 `auto_redirect`）；dnsmasq 不改动，`local` 经它查询运营商的 DNS，它发给上游的查询不进 sing-box（TUN 自动加 `exclude_uid`，并在 `auto_redirect` 的回退规则前为 dnsmasq 加一条路由规则，IPv6 上游也从 WAN 走；TProxy 跳过 dnsmasq 用户） |
| IPv6 接管 | 已实现 | 新界面接管页的「接管 IPv6」开关，同时改 DNS 的解析策略 |
| 访问控制（按设备 IP 或 MAC 设黑名单或白名单） | 未实现 | 设计文档 M1 有，后端和两套界面都没有 |
| 订阅 | 已实现 | 新界面策略页增删改、手动更新；每小时检查定时更新 |
| 配置文件（多份配置） | 已实现 | 新界面配置文件页新建、切换、删除 |
| 日志 | 已实现 | 按天轮转和自动清理；新界面日志页设置自动清理和保留天数，查看当天的插件日志和内核日志 |
| 测速设置 | 已实现 | 新界面设置页 |
| 配置迁移 | 已实现 | `migrate.uc` 逐级迁移，当前版本 4 |
| 回归测试与 CI | 已实现 | `tests/run.sh` 覆盖生成器和迁移；CI 构建前端并打包 |
| 分享链接导入、订阅格式转换（Clash、分享链接、base64） | 不做 | M1 不做 |

## 3. 新界面（`/hako/`）

| 页面 | 状态 | 说明 |
| --- | --- | --- |
| 登录 | 已实现 | |
| 活动 | 部分实现 | 只显示运行状态、配置、接管（含代理端口）、出站模式、内核和插件版本；缺启动、停止、重载、启用，内核安装和更新，运行时长 |
| 接管 | 已实现 | 接管、TUN 或 TProxy、代理端口三张卡片；FakeIP 在内核设置 › DNS |
| 策略 | 已实现 | 节点、策略组、订阅、延迟测试、出站模式切换 |
| 规则 | 已实现 | 规则、规则集、设置三个标签 |
| 内核设置 | 部分实现 | 日志、DNS、NTP、HTTP 客户端、API、实验性六个标签；缺口见第 1 节 |
| 配置文件 | 已实现 | 列出全部配置，新建、使用、查看生成的配置、删除 |
| 日志 | 已实现 | 日志设置（自动清理、保留天数），插件日志和内核日志两个标签，每 3 秒刷新，「清空」只清空显示 |
| 设置 | 已实现 | 测速 |
| 设备 | 未实现 | 设计稿在「规划中」，还没加入菜单 |

## 4. 旧 LuCI 界面

活动、接管、策略、路由规则、内核设置、配置文件、日志、插件设置八页都已实现。

## 5. 验证

| 项 | 状态 | 说明 |
| --- | --- | --- |
| x86_64 实机（N100）跑通透明代理 | 已验证 | TUN 模式 |
| arm64 实机跑通透明代理 | 未验证 | 设计文档 M1 的完成标准 |
| 停止服务后路由、nft 规则和 DNS 恢复原状 | 未记录 | |
| 访问控制生效 | 未实现 | |
