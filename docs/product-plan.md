# OpenBox 产品规划

> 在 OpenWrt 上运行 sing-box 的简约客户端。

## 1. 理念

- **UCI 是唯一真相**：用户用表单描述节点、策略组和接管方式，存进 UCI；OpenBox 每次启动时生成 sing-box 配置。生成结果只读，可以查看但不用手改。
- **原生 JSON 作为可选项**：在「配置文件」页选用一份 sing-box JSON 时，原样运行，不经过生成器。
- **少即是多**：只暴露必要的开关，其余都是合理的默认值，不让用户面对上百个选项。
- **现代**：OpenWrt 25.12，只用 fw4/nftables、ucode 和 LuCI JS，不依赖 Lua、Ruby 或 Python。
- **干净**：启动失败就不接管流量；停止后系统回到安装前的状态。

## 2. 范围

只做 **M0** 和 **M1**，之后的方向等 M1 完成后再定。

### M0 · 脚手架

- 一个 feed 仓库，包含两个包：`openbox`（后端）和 `luci-app-openbox`（界面）。翻译由 po 文件自动生成 `luci-i18n-openbox-zh-cn`。
- 所有包都与架构无关（`PKGARCH:=all`），每个 OpenWrt 版本只需构建一次。
- GitHub Actions：用 OpenWrt 25.12 SDK 构建，产出 apk。打 `v*` tag 时自动发布到 GitHub Release。
- `install.sh` 从 GitHub Release 下载安装；`uninstall.sh` 负责卸载。暂不自建签名软件源（`feed.sh`）。

**完成标准**：CI 产出的包能装到 OpenWrt 25.12 上，LuCI 菜单里出现“OpenBox”。

### M1 · 生成器与透明代理

| 能力 | 内容 |
| --- | --- |
| 运行 | procd 托管 sing-box，崩溃后自动拉起；启动前执行 `sing-box check`，不通过就不启动；重载失败时保留旧配置继续运行 |
| 内核 | 从 GitHub 安装最新版，或上传官方 apk；要求 sing-box ≥ 1.14 |
| 生成器 | 从 UCI 生成 sing-box 配置，写入 `/var/run/openbox/config.json`；界面可查看生成结果 |
| 节点 | 手动添加、编辑、删除。支持 Shadowsocks、VMess、VLESS（含 Reality）、Trojan、Hysteria2（可端口跳跃）、TUIC、AnyTLS、NaiveProxy、Snell（v4/v5、v6）、SSH、SOCKS、HTTP；每个节点可在弹窗的「拨号」页用 JSON 填写 sing-box 拨号字段，前置节点（`detour`）也写在这里；Hysteria v1、ShadowTLS（只是给其他节点包一层 TLS 的前置，不单独使用；订阅里的 ShadowTLS 节点照常保留，Global 不会把它加入）、WireGuard（sing-box 1.11 起只能作为 endpoint）、Tor（需另装 tor）、bridge（三层转发）不做；订阅里的 WireGuard 等 endpoint 节点照常使用 |
| 策略组 | 手动选择或自动测速；成员逐个添加节点和组，可拖动排序，不提供“全部节点”“全部策略组”；手动选择可设默认出站，自动测速可设闲置超时，两者都可设切换时中断现有连接；运行时可切换当前选择，并可对组内全部成员测延迟 |
| 出站模式 | 规则判定 / 全局代理 / 直接连接，运行时切换；全局代理时国内 IP 也走代理 |
| 透明代理 | 一个总开关，接管局域网和路由器自身的流量。接管方式二选一：TUN（sing-box 的 `auto_route` + `auto_redirect`，规则由 sing-box 设置）或 TProxy（OpenBox 设置 nft 规则和策略路由）；DNS 由 sing-box 应答，本地域名交还 dnsmasq；默认只接管 IPv4，可开启 IPv6 接管 |
| 访问控制 | 按设备（IP 或 MAC）设置黑名单或白名单 |
| 绕过与分流 | 内网和保留地址始终直连；国内 IP 用自带的规则集在防火墙层绕过；DNS 先问国内 DNS，国内 IP 原样返回，其余返回 FakeIP 并由节点解析 |
| 配置文件 | 本地、订阅两种配置（见 3.1）：都基于内置模板新建，设置页编辑当前配置；订阅配置的节点来自订阅，只读，其余可编辑 |
| 日志 | 日志设置在页面上方：自动清理（默认开启）、保留天数（默认 7 天）、内核日志级别；下方插件日志和内核日志分两个标签，只显示当天的日志并自动刷新，「清空」只清空显示、不删除文件；后台按天保存，每天零点轮转 |

**M1 不做**（之后再定）：分享链接导入、订阅、redirect 接管模式、自定义 JSON 片段（DNS 规则除外）。

**完成标准**：在 x86_64 虚拟机和一台 arm64 真机上，只用表单添加一个节点就能跑通透明代理；访问控制生效；停止服务后路由、nft 规则和 DNS 都恢复原状。

## 3. 设计

### 3.1 配置

> **基线版本**：插件还在开发阶段，只有一台实机（N100），这一版的配置结构作为基线，不为之前的版本写迁移：`main.config_version` 从 `1` 重新开始，`migrate.uc` 的旧步骤全部删掉，实机重装默认配置。此后改动默认值，照 3.3.3 逐级加迁移步骤。

设置分两层，参考 Surge：**设备设置**跟着路由器走，切换配置不受影响；**配置内容**跟着配置走，策略、路由规则和内核设置页编辑的就是当前使用的配置。

| 层级 | 内容 | 存放 |
| --- | --- | --- |
| 设备设置 | 启用、当前配置（`main.profile`）、出站模式、接管（TUN / TProxy、DNS 入站、代理端口、绕过）、访问控制、Clash API 与缓存文件、插件设置（测速）、日志保留 | `/etc/config/openbox` |
| 配置内容 | 节点、策略组、路由规则、规则集、默认出站等路由设置、DNS、sing-box 日志级别、NTP | 每份配置一个 UCI 包 `/etc/config/openbox_<标识>` |

配置有两种，都是一个配置包，设置页都能编辑：

| 类型 | 怎么来 | 节点 |
| --- | --- | --- |
| 本地 | 新建时来源选「默认配置」：复制插件内置的模板 `/usr/share/openbox/template/openbox_template` | 在策略页增删改 |
| 订阅 | 新建时来源选「远程订阅」：同样复制模板，再在包里的 `config profile 'profile'` 记下 `url`、`update_interval`、`user_agent` | 全部来自订阅，随订阅更新；策略页只读列出，不能新增、编辑或删除，只能测试延迟 |

订阅只提供节点：订阅返回完整的 sing-box JSON，下载到 `/etc/openbox/subscriptions/<标识>.json`，生成时只取其中的节点，策略组、规则、DNS 等全部用配置包自己的，所以不会和设备设置冲突。新建后订阅的节点只自动出现在 Global 里，要在 Proxy 等策略组里使用，需在组的出站标签里逐个添加（按名字引用）。

- **配置名与标识**：配置名可以是任意文字（去掉首尾空格后不能为空，也不能和已有的重名），只用来显示，存在包里 `config profile 'profile'` 的 `title`。内部标识在新建时自动取当前的毫秒时间戳（13 位，被占用时加 1），用作包名 `openbox_<标识>` 和订阅文件名，`main.profile` 记的也是它；没有 `title` 时显示标识（如 `default`）。
- **默认配置**：首次安装由模板创建 `openbox_default` 并设为当前配置。它和其他本地配置一样可以编辑、删除；需要时随时可以再基于内置模板新建。
- **删除**：使用中的配置不能删除；删除订阅配置时，下载的内容一起删掉。
- 之前的原生 JSON 配置（`/etc/openbox/profiles/*.json`，上传、粘贴、编辑 JSON）不再支持，界面上的「查看」只显示生成的 JSON。

运行的配置由当前配置和设备设置生成（`generate.uc`），写入 `/var/run/openbox/config.json`，经 `sing-box check` 后运行。配置包有 `profile.url` 时，生成器把订阅 JSON 中 `outbounds` 和 `endpoints` 里的节点（`direct`、`block`、`dns`、`selector`、`urltest` 以外的类型）追加进来：

- 与配置包里出站重名的订阅节点跳过并给出警告。
- 策略组的成员和路由规则可以按名字引用它们；Global 自动包含它们。
- 订阅节点的 `detour` 只保留指向其他订阅节点的；`domain_resolver` 指向配置里没有的 DNS 服务器（多半是订阅自己的）时去掉，改用路由的默认解析服务器。

订阅更新后，如果当前使用的正是这份配置，就重载（见 3.3.4）。

实现分两步，每步都能单独发布：

1. **配置包**：设备设置和配置内容拆开，`generate.uc` 读当前配置包；`config_version` 重置为 1；配置文件页按设计稿重写（列表、「使用」和「更多」菜单、新建、查看弹窗）；各设置页改为编辑当前配置包。
2. **订阅**：新建时可选「远程订阅」，订阅只提供节点，可自定义 User-Agent；策略页的订阅节点只读、可测延迟。

> **技术验证结论**（OpenWrt 25.12 容器，sing-box 1.14.3）：`tun` 入站的 `auto_route` + `auto_redirect` 能接管局域网设备和路由器自身的流量。TCP 经 nftables 重定向，UDP 经策略路由进入 TUN；sing-box 自建 `inet sing-box` 表，与 fw4 互不影响，重启防火墙不丢接管，停止后清理干净。节点不可用时流量不会泄露为直连。TProxy 由 OpenBox 自建 `inet openbox` 表和策略路由，同样逐项验证通过。

### 3.2 数据模型（`/etc/config/openbox` 与 `/etc/config/openbox_<标识>`）

原则：**所有配置都来自 UCI**，生成器里不写任何具体的值，只负责翻译和必要的计算。

下面的 section 按 3.1 分在两个包里：类型为 `openbox`（`main`、`logs`、`latency`、`firewall`）、`inbound`、`experimental` 的属于设备设置，在 `openbox`；其余（`log`、`dns`、`dns_server`、`dns_rule`、`ntp`、`route`、`rule_set`、`http_client`、`outbound`、`route_rule`）属于配置，在当前配置的包里。软件包附带的默认值也分两份：`openbox.conf` 是设备设置，`template/openbox_template` 是新建配置时复制的模板（装到 `/usr/share/openbox/template/`，这个目录本身可以当 UCI 目录读）。设备设置引用的规则集（如 `route_exclude_address_set`、`firewall.bypass_rule_set` 的 `cn_ip`）在当前配置里查找。界面上，接管、插件设置和日志页编辑 `openbox`；策略、路由规则和内核设置页编辑当前配置的包，内核设置的「实验性」（Clash API、缓存文件）和接管页的 DNS 模式、FakeIP 地址段例外，分别写到另一个包。ACL 用 `openbox_*` 放行所有配置包。

命名约定：
- **能用 sing-box 的就以 sing-box 为准**：section 类型是 sing-box 的顶层键（数组元素用单数，如 `outbound`、`route_rule`），section 名是下一层的键或元素的内部标识，option 沿用 sing-box 字段名，嵌套字段用 `_` 连接（`tls.server_name` → `tls_server_name`）。
- **OpenBox 自己加的概念参考 mihomo 命名**：`hidden`。
- 引用（`outbounds`、`default`、`final`、`outbound`、`detour`、`server`、`domain_resolver`、`default_domain_resolver`、`rule_set`、`route_exclude_address_set`、`http_client`）可以写 section 名或 tag，先按 section 名查找；节点 `dial_fields` 里的 JSON 原样使用，只能写 tag。
- DNS 服务器等 UCI 里的 `detour` 不能指向 direct 类型的出站（sing-box 会报错），生成时忽略并给出警告；留空就是直连。
- 生成器按字段类型表转换布尔、数字和列表；表中没有的 option 会被跳过并给出警告。

下面是软件包附带的默认值，加上若干示例：

```
config openbox 'main'              # OpenBox 自身的设置
    option config_version '13'      # 配置格式的版本，升级时由迁移脚本逐级更新（2：加入 mixed 入站；3：固定的路由规则标 hidden；4：local 改为 local 类型，AliDNS 改名 alidns；5：FakeIP 加 IPv6 地址段；6：绕过的 IPv6 地址 fc00::/7 改为 fd00::/8；7：删掉 dnsmasq 服务器，局域网域名改用 local；8：拒绝 QUIC 改按嗅探到的协议；9：开启 find_neighbor；10：TUN 接管也启用 dns_in，供 dnsmasq 转发；11：FakeIP 的 IPv6 地址段 fc00::/18 改为 2001:2::/48；12：FakeIP 应答的 TTL 改为 1 秒；13：加入插件设置的测速段 latency）
    option enabled '0'
    option source 'model'          # model | profile
    option profile ''              # source 为 profile 时使用的文件
    # option mode 'Global'         # 出站模式：在活动页选择后立即写入并重载，由 OpenBox 经 clash API 设到 sing-box；
                                   # 也决定国内 IP 是否在防火墙层绕过；没有时取 clash_api.default_mode

config openbox 'logs'              # OpenBox 的日志管理
    option auto_clean '1'          # 自动清理按天保存的旧日志
    option retention_days '7'      # 保留天数（含当天）

config openbox 'latency'           # 测速，OpenBox 自己的概念；插件设置页「测速」标签，默认为空段
    # option url ''                # 手动测速（策略组「延迟测试」、节点「延迟测试」）的地址，经 clash API 的 url 参数传给 sing-box；
                                   # 自动测速组没写 url 时，生成器也用它；不写时 sing-box 用 https://www.gstatic.com/generate_204
    # option timeout '5s'          # 手动测速的超时，sing-box 时长写法（界面按秒填），最多 15 秒；自动测速组的超时由 sing-box 固定

config profile 'profile'           # 示例：配置包里的这一段（在 openbox_<标识> 里，不在 openbox 里），OpenBox 自己的概念，生成器只读 url
    option title '机场 A'           # 配置名，任意文字，只用来显示
    option url 'https://example.com/sing-box.json'  # 订阅配置才有：返回完整的 sing-box JSON 配置（http / https），只取其中的节点
    option update_interval '24h'   # sing-box 时长写法（界面按小时填）；不写或 '0' 时只手动更新
    option user_agent ''           # 不写时为 sing-box/<内核版本> OpenBox/<插件版本>
    option last_update '1792230866'  # 由 subscription.sh 写入：最近一次成功更新的时间（epoch）
    # option last_error ''         # 由 subscription.sh 写入：最近一次失败的原因，成功后删除

config log 'log'                   # → log
    option level 'warn'            # info 及更低级别会为每个连接记录日志
    option timestamp '1'

config dns 'dns'                   # → dns
    option final 'cloudflare'      # 规则都没命中时用的 DNS 服务器；留空时 sing-box 用第一个，即 local，会绕回 sing-box，所以要明确设置
    option strategy 'ipv4_only'    # 只解析 IPv4；开启 IPv6 接管时为 prefer_ipv4
    option optimistic '1'          # 乐观缓存：过期先返回旧结果，后台刷新
    # option custom_rules '[...]'  # OpenBox：sing-box 原生 DNS 规则的 JSON 数组，原样插到下面局域网域名规则之后、
                                   # 国内外分流（evaluate 开始）之前；内核设置 → DNS 里编辑，不经字段转换，官方字段都能用

config dns_server 'local'          # → dns.servers[]；系统解析（OpenWrt 上经 /etc/resolv.conf 交给 dnsmasq），解析局域网域名
    option tag 'local'
    option type 'local'            # local | udp | tcp | tls | quic | https | h3 | fakeip；界面列表不显示 local 和 fakeip，
                                   # 其余按官方文档显示为 UDP、TCP、TLS、QUIC、HTTPS、HTTP/3

config dns_server 'alidns'         # 国内 DNS（阿里 DNS），直连；DNS over QUIC（UDP 853），不经 53 端口，
    option tag 'alidns'            # 不会被运营商劫持，路由器自己的 53 端口查询被接管时也不受影响
    option type 'quic'
    option server '223.5.5.5'      # 其余字段：server_port、path、tls_server_name、
                                   # detour（出站）、domain_resolver（DNS 服务器）

config dns_server 'cloudflare'     # 经代理的 DoH（Cloudflare），兜底；之前的配置里叫 remote
    option tag 'cloudflare'
    option type 'https'
    option server '1.1.1.1'
    option detour 'proxy'

config dns_server 'fakeip'         # 在「接管」页随 DNS 模式设置，内核设置的 DNS 服务器列表里不显示
    option tag 'fakeip'
    option type 'fakeip'
    option inet4_range '198.18.0.0/15'
    option inet6_range '2001:2::/48' # 基准测试地址段（RFC 5180），与 IPv4 的 198.18.0.0/15 对应；不用 sing-box 示例的 fc00::/18：dnsmasq 的重绑定保护会丢弃 fc00::/7 的应答；dns.strategy 为 ipv4_only 时用不到

config dns_rule                    # → dns.rules[]，按顺序生成
    list   domain_suffix 'lan'     # 本地域名和私有网段的反查经系统解析（local）交给 dnsmasq
    list   domain_suffix '10.in-addr.arpa'
    list   domain_suffix '168.192.in-addr.arpa'
    list   domain_regex '\.(1[6-9]|2[0-9]|3[01])\.172\.in-addr\.arpa$'
    option server 'local'

config dns_rule                    # 先问国内 DNS，最多等 2 秒
    option action 'evaluate'
    option server 'alidns'
    option timeout '2s'

config dns_rule                    # 答案是国内 IP：原样返回
    option match_response '1'
    list   rule_set 'cn_ip'
    option action 'respond'

config dns_rule 'foreign'          # 其余有地址的 A/AAAA：返回 FakeIP（DNS 模式为 RealIP 时 server 是 remote）
    option match_response '1'
    option response_rcode 'NOERROR'
    option ip_accept_any '1'
    list   query_type 'A'
    list   query_type 'AAAA'
    option server 'fakeip'
    option rewrite_ttl '1'         # 仅 FakeIP：设备几乎不缓存假地址，停止后下一次查询即拿到真实地址；RealIP 时不设，保留真实 TTL

# 另有三条：其余 NOERROR、NXDOMAIN 原样返回；
# 'fallback'：国内 DNS 无响应时，A/AAAA 交给与 'foreign' 相同的服务器

config ntp 'ntp'                   # → ntp；系统已有 sysntpd，默认关闭
    option enabled '0'
    option server 'ntp.aliyun.com'
    option server_port '123'       # sing-box 默认值
    option interval '30m'          # sing-box 默认值；其余字段：detour、domain_resolver

config experimental 'clash_api'    # → experimental.clash_api；删除此 section 即关闭
    option external_controller '127.0.0.1:9090'
    option secret ''
    option default_mode 'Rule'     # 固定为 Rule，界面不提供；实际模式由活动页的出站模式（main.mode）决定

config experimental 'cache_file'   # → experimental.cache_file，保存出站模式、各组的选择与 FakeIP 映射
    option enabled '1'
    option path '/etc/openbox/cache.db'
    option store_fakeip '1'

config inbound 'tun'               # → inbounds[]；enabled 即接管总开关，默认开启（TUN）
    option enabled '1'
    option type 'tun'              # tun；TProxy 见下面的 'tproxy' 段
    option tag 'tun-in'
    option interface_name 'openbox-tun'
    list   address '172.19.0.1/30'
    option auto_route '1'
    option auto_redirect '1'
    list   route_exclude_address '10.0.0.0/8'     # 保留地址，与 TProxy 默认值相同（IPv4 10 项 + IPv6 4 项）
    list   route_exclude_address 'fd00::/8'   # 实际在用的 ULA
    list   route_exclude_address_set 'cn_ip'  # 国内 IP 在防火墙层绕过

config route 'route'               # → route
    option final 'final'           # 规则都没命中的流量走 Final 组
    option default_domain_resolver 'alidns'  # 解析节点域名用的 DNS 服务器，必须直连
                                            # auto_detect_interface 不是选项：生成器总是开启，出站绑定物理网卡，接管时避免回环
    option find_neighbor '1'                # 日志显示局域网设备的 MAC 和主机名（路由规则页 → 路由设置 →「邻居解析」）
    # list dhcp_lease_files ''              # 默认不写：sing-box 自动探测 /tmp/dhcp.leases（OpenWrt 的 dnsmasq）等租约文件
    # option default_http_client ''   # 远程规则集默认的下载方式；模板留空，即第一个 HTTP 客户端（内置的 HTTP Proxy）

config rule_set 'cn_ip'            # → route.rule_set[]
    option tag 'cn-mainland-ip'
    option type 'local'            # local | remote | inline；随软件包附带，启动时不用下载
    option format 'binary'         # 可留空：按 path / url 的扩展名（.srs / .json）判断
    option path '/usr/share/openbox/rule-set/cn-mainland-ip.srs'
    # remote：url、http_client、update_interval、initial_path（还没下载时先用的本地文件）
    # inline：option rules '[...]'  # sing-box 无头规则的 JSON 数组，原样写入；TProxy 的绕过也能用

config inbound 'tproxy'            # TProxy 接管时启用，'tun' 关闭
    option enabled '0'
    option type 'tproxy'
    option tag 'tproxy-in'
    option listen '::'
    option listen_port '7893'

config inbound 'dns_in'            # 接管时启用（TUN 和 TProxy）：dnsmasq 的查询转发到这里；TProxy 时 53 端口的查询也被重定向到这里
    option enabled '1'
    option type 'direct'
    option tag 'dns-in'
    option listen '::'
    option listen_port '1053'

config inbound 'mixed'             # 代理端口：局域网设备手动设置的 HTTP / SOCKS5 代理，与接管互相独立，默认关闭
    option enabled '0'
    option type 'mixed'
    option tag 'mixed-in'
    option listen '::'               # 防火墙的 WAN 区域默认拒绝入站，外网连不进来
    option listen_port '7890'
    # option username ''           # 用户名和密码都填时生成 users，否则不需要密码
    # option password ''

config openbox 'firewall'          # OpenBox 为 TProxy 设置的防火墙与策略路由（TUN 不用）
    option ipv6 '0'                # OpenBox：TProxy 是否接管 IPv6；接管页的 IPv6 开关同时改它、dns.strategy 和 TUN 的 IPv6 地址
    list   interface 'lan'         # 从这些接口进入的流量被接管
    list   bypass_address '10.0.0.0/8'   # 保留地址，共 10 项
    list   bypass_address6 'fd00::/8'    # 绕过的 IPv6 地址（共 4 项）；不接管 IPv6 时其余 TCP/UDP 拒绝；fd00::/8 是实际在用的 ULA
    list   bypass_rule_set 'cn_ip'  # 本地规则集，反编译后放入 nft 集合
    option mark '0x6f62'           # 要交给 TProxy 的包
    option output_mark '0x6f63'    # sing-box 自己的连接（生成为 route.default_mark）
    option route_table '233'
    option rule_priority '1100'

config http_client 'proxy_client'  # 模板内置：经 Proxy 组下载，tag 为 HTTP Proxy；默认 HTTP 客户端留空，用的就是它；
    option tag 'HTTP Proxy'        # 没有节点时 Proxy 只含 Direct，等于直连；加了节点后自动走节点。
    option dial_fields '{"detour": "Proxy"}'  # 启动时节点都不可用、又没有缓存，首次下载远程规则集会失败、sing-box 起不来，可给规则集设初始文件

config http_client 'via_proxy'     # 示例 → http_clients[]，供远程规则集和 Hysteria2 realm 发请求
    option tag 'via-proxy'
    option version '2'             # HTTP 版本 1 / 2 / 3，留空为 2
    option disable_version_fallback '0'  # 不自动回退到更低的 HTTP 版本
    list   headers 'User-Agent: sing-box'  # 请求头，"名称: 值"
    option initial_packet_size ''  # QUIC 字段，只在版本 3 生成：initial_packet_size、disable_path_mtu_discovery
    option idle_timeout ''         # HTTP2 字段，版本 2、3 生成：idle_timeout、keep_alive_period、
                                   # stream_receive_window、connection_receive_window、max_concurrent_streams
    option tls_fields ''           # TLS 字段，JSON 对象 → tls
    option dial_fields '{"detour": "Proxy"}'  # 拨号字段，JSON 对象，原样合并；经哪个出站就写在 detour 里，留空为直连

config outbound 'direct'           # → outbounds[]
    option tag 'Direct'
    option type 'direct'
    option hidden '1'              # mihomo：不在策略页的策略组、节点列表中显示，仍可在各处选用

config outbound 'hk01'             # 节点示例
    option tag '香港 01'
    option type 'vless'            # direct | shadowsocks | vmess | vless | trojan | hysteria2 | hysteria | tuic | anytls
                                   # | naive | snell | ssh | socks | http
    option server 'example.com'
    option server_port '443'
    option uuid '…'
    option tls_enabled '1'         # 其余字段：password、method、flow、tls_server_name、
    …                              # tls_insecure、tls_utls_fingerprint、
                                   # tls_reality_enabled/public_key/short_id；tls_fields（弹窗 TLS 页的「高级编辑」）是
                                   # sing-box TLS 字段组成的 JSON 对象，原样合并进 tls，覆盖上面的同名字段，TLS 未启用时不用；
                                   # 弹窗里 TLS 页的字段和它双向同步（改字段写进 JSON，改 JSON 回填字段），以 JSON 为准；
                                   # JSON 里总显示 "enabled": true，不能写成 false（固定 TLS 的协议 sing-box 报 TLS required，
                                   # 可选 TLS 的协议用「启用 TLS」关闭）；
                                   # transport_type（ws | httpupgrade | grpc | http | quic）/path/host/service_name/method、
                                   # transport_host（httpupgrade、http）是 list，http 全部输出，httpupgrade 取第一项
                                   # （旧的单值 option 照常读取）；
                                   # transport_headers（ws、httpupgrade、http）是 list，每项 "名称: 值"，同名多项生成值的数组；
                                   # ws 没有 host 字段，Host 写在 transport_headers 里，不提供前置数据（early data）；
                                   # hysteria2：obfs_type/password，gecko 另有 obfs_min_packet_size/max_packet_size；hop_interval_max、
                                   # bbr_profile、brutal_debug、disable_chrome_parrot；realm_server_url 有值时经 Hysteria Realm 连接，
                                   # 不输出 server、server_port、server_ports，另有 realm_token、realm_realm_id、realm_stun_servers（list）、
                                   # realm_ip_version、realm_port_mapping_enabled/timeout/lifetime、realm_http_client（http_client 配置段）；
                                   # snell：version（必填，4 即 v4/v5，或 6）、psk、userkey、reuse、obfs_mode/host（v4）、mode（v6）；
                                   # socks：version、username、udp_over_tcp；http：username、path、headers（同 transport_headers 的 list）；
                                   # vmess：uuid、security、alter_id、global_padding、authenticated_length、packet_encoding，可用 tls 与 transport；vless 也有 packet_encoding；
                                   # shadowsocks：plugin、plugin_opts、udp_over_tcp；shadowsocks、trojan、anytls 的 password 必填；
                                   # hysteria2 另有 server_ports、hop_interval（设置后不输出 server_port）；
                                   # tuic：uuid、password、congestion_control、udp_relay_mode、udp_over_stream（与 udp_relay_mode 互斥，
                                   # 弹窗里只在中继模式为默认时显示）、zero_rtt_handshake、heartbeat；
                                   # hysteria、hysteria2、tuic 另有 QUIC 字段（弹窗的「QUIC」页）：initial_packet_size、
                                   # disable_path_mtu_discovery、idle_timeout、keep_alive_period、stream_receive_window、
                                   # connection_receive_window、max_concurrent_streams（窗口写 6MB 或 64 MB 这样的大小，纯数字按字节数输出）；
                                   # anytls：password（必填）、idle_session_check_interval、idle_session_timeout、min_idle_session、
                                   # client_metadata；naive：username、password、insecure_concurrency、extra_headers（同 transport_headers 的 list）、
                                   # stream_receive_window、udp_over_tcp、quic，开启 quic 后另有 quic_congestion_control、
                                   # quic_session_receive_window（两个窗口写 6MB 这样的大小，纯数字按字节数输出）；
                                   # ssh：user、password、private_key（PEM 文本，按行输出为数组）、private_key_path、
                                   # private_key_passphrase、host_key、host_key_algorithms、client_version、cipher、mac、
                                   # kex_algorithm（后五项除 client_version 外都是 list）；
                                   # shadowsocks、vmess、vless、trojan、hysteria2、hysteria、tuic、snell、socks 另有 network；
                                   # shadowsocks、vmess、vless、trojan 另有多路复用（弹窗的「多路复用」页）：multiplex_enabled/protocol/
                                   # max_connections/min_streams/max_streams/padding、multiplex_brutal_enabled/up_mbps/down_mbps
                                   # （max_streams 与另两个上限互斥，弹窗里填了最大连接数或最小流数就不显示最大流数）；
                                   # 节点的拨号字段只写在 dial_fields 里：这个 JSON 对象（任意 sing-box 拨号字段，
                                   # 出站和 DNS 服务器按 tag 引用，如前置节点 detour）原样合并进节点；
                                   # 不是 JSON 对象时跳过并警告。
                                   # 生成器只读节点编辑弹窗里有的字段，两边保持一致；弹窗里没有的 sing-box 字段不支持。

config outbound 'proxy'            # 策略组也是 outbound
    option tag 'Proxy'
    option type 'selector'         # selector | urltest
    list   outbounds 'hk'          # sing-box：成员，按列出的顺序；订阅节点按名字引用
    list   outbounds 'direct'
    option default ''              # sing-box：selector 的默认出站，必须是成员，否则忽略并警告；留空用第一个成员
    option interrupt_exist_connections '0'  # sing-box：当前出站改变时中断现有连接（两种组都可用）

config outbound 'final'            # 规则都没命中的流量走这个组（route.final），同 Surge 的 FINAL
    option tag 'Final'
    option type 'selector'
    list   outbounds 'proxy'
    list   outbounds 'direct'

config outbound 'global'           # 全局模式使用的组
    option tag 'Global'
    option type 'selector'
    option hidden '1'              # 隐藏的组自动包含全部节点、Direct 和所有未隐藏的组；组不会包含隐藏的组，所以不会形成循环

config outbound 'hk'               # 示例：在列出的节点中自动测速
    option tag '香港'
    option type 'urltest'
    list   outbounds 'hk01'
    list   outbounds 'hk02'
    option interval '3m'
    option idle_timeout ''         # sing-box：闲置超过这个时间后暂停测速，默认 30m

config route_rule                  # → route.rules[]，按顺序生成
    option action 'sniff'          # 嗅探协议和域名
    option hidden '1'              # 前 5 条是固定规则，路由规则页不显示，新规则和拖动都排在它们后面

config route_rule
    list   protocol 'dns'
    option action 'hijack-dns'     # DNS 交给 sing-box 的 DNS 模块
    option hidden '1'

config route_rule
    option ip_is_private '1'
    option outbound 'direct'
    option hidden '1'

config route_rule
    option clash_mode 'Direct'
    option outbound 'direct'
    option hidden '1'

config route_rule
    option clash_mode 'Global'
    option outbound 'global'
    option hidden '1'

config route_rule                  # 拒绝 DoT/DoQ，防止绕开 DNS 劫持
    list   port '853'
    option action 'reject'

config route_rule                  # 拒绝 QUIC（按嗅探到的协议），应用回退到 TCP
    list   protocol 'quic'
    option action 'reject'
    # option comment ''            # OpenBox：注释，只在路由规则页显示，不生成

config route_rule                  # 国内 IP 直连（经 TUN 以外进入 sing-box 的流量）
    list   rule_set 'cn_ip'
    option outbound 'direct'

# config route_rule                # 逻辑规则：and / or 组合子规则，动作用这一条的
#     option type 'logical'
#     option mode 'and'
#     option id 'a1b2c3d4'         # OpenBox：子规则用它指向这条规则，不生成
#     option outbound 'proxy'
#
# config route_subrule             # → 所属逻辑规则的 rules[]，按顺序生成
#     option rule 'a1b2c3d4'       # OpenBox：所属逻辑规则的 id
#     list   source_ip_cidr '192.168.1.50/32'
#
# config route_subrule
#     option rule 'a1b2c3d4'
#     option json '{"type":"logical","mode":"or","rules":[{"port":[80]},{"port":[443]}]}'
#     option invert '1'
```

规则：
- UCI 的 section 名在整个文件内必须唯一（不分类型）。
- `tag` 在所有 outbound 之间必须唯一，不能使用 `GLOBAL`（clash API 自动生成的组名）。
- `enabled '0'` 可以停用某个 outbound、入站、规则集或规则（sing-box 没有这个字段，沿用 UCI 惯例）。
- 删除 `Global` 组或模式规则后，对应的出站模式会消失或失效；界面给出提示，但不阻止。

**暂未纳入**：按设备的访问控制、路由器自身服务的排除（`exclude_uid`）。确定后同样按上述约定放进 UCI。

### 3.3 生成规则（`generate.uc`）

| 部分 | 生成内容 |
| --- | --- |
| 日志 | `config log 'log'` |
| 出站 | 每个启用的 `outbound` 一个出站。策略组的成员就是 `outbounds` 列出的，按列出的顺序（即弹窗里拖动排好的顺序）；隐藏的组（全局模式的 Global）再自动带上没列出的全部节点（含订阅节点）、Direct 和所有未隐藏的组。不提供「包含全部节点 / 全部策略组」。防环：列出的组若已直接或经其他组包含本组（隐藏的组算作包含所有未隐藏的组），就丢弃这个引用并警告（页面保存时已拦截，这里是保底，防导入或手改 UCI 造成的循环），例如 Proxy、Final 互相列出时两边都丢弃对方；`sing-box check` 查不出组的循环，要到启动时才报 circular outbound dependency 而无法启动 |
| 入站 | 启用的 `config inbound`：`tun`，或 `tproxy` 加 `direct`（DNS）；另有可单独启用的 `mixed`（代理端口，`username` / `password` 生成为 `users`）；启用 TProxy 时 `route.default_mark` 取 `firewall.output_mark`。都关闭时不生成入站，sing-box 只提供出站模式和组切换 |
| 路由规则 | `config route_rule` 按顺序生成；默认动作 `route` 必须有有效的 `outbound`，否则跳过并警告；逻辑规则写作 `type 'logical'`、`mode`（and / or）和一个 `id`；它的子规则是单独的 `config route_subrule`，用 `option rule '<id>'` 指向它，按配置里的顺序生成为 `rules`；子规则只有匹配条件（字段同标准规则，外加 `invert`），或者用 `json` 原样写一条（多个条件、嵌套 logical）；没有条件的子规则跳过并警告，没有子规则的逻辑规则也跳过并警告；`hidden` 只用于界面，不生成；`final` 取 `route.final` 指向的节点或组 |
| 规则集 | `config rule_set` → `route.rule_set`；`config http_client` → `http_clients`，供远程规则集下载；引用的 HTTP 客户端不存在时去掉引用并警告，改用默认的；一个 HTTP 客户端都没定义、又有远程规则集或 Hysteria2 realm 时，生成器补一个 tag 为 `Default` 的，经 `route.final` 出去（`route.final` 是 Direct 出站时直连），和 sing-box 1.16 前的隐式默认一致 |
| clash API | 存在 `config experimental 'clash_api'` 时生成 |
| DNS | `config dns 'dns'` 加上所有 `config dns_server` 和按顺序的 `config dns_rule`；发往服务器的动作（`route`、`evaluate`）必须有有效的 `server`；`dns.custom_rules`（JSON 数组）原样插到第一条 `evaluate` 规则之前，JSON 无效时跳过并警告；规则里的 `strategy` 已被 sing-box 1.14 弃用，不再生成 |
| NTP | `config ntp 'ntp'`；默认关闭，路由器时钟不可靠时再开启 |
| 缓存文件 | 存在 `config experimental 'cache_file'` 时生成；默认放在闪存上，路由器重启和系统升级后仍保留出站模式、各组的选择和 FakeIP 映射 |

默认配置（没有节点）生成的结果：`Direct`、只含 `Direct` 的 `Proxy`、含 `Proxy` 和 `Direct` 的 `Final`（`route.final` 指向它）、包含 `Proxy`、`Final` 和 `Direct` 的 `Global`；DNS 分流和路由规则；国内 IP 规则集；经 Proxy 组的 HTTP 客户端 `HTTP Proxy`（默认 HTTP 客户端留空，即用第一个，也就是它）；clash API 和缓存文件。接管默认开启（TUN），开启 OpenBox 后即接管流量；关闭接管时不生成入站。

生成器只在一个地方适配 sing-box 的版本差异。将来 sing-box 改格式时，只需改生成器，用户的 UCI 不受影响。

### 3.3.1 日志

- 插件日志 `/var/log/openbox/app.log`、内核日志 `/var/log/openbox/core.log` 记录当天的内容；sing-box 的标准输出由 OpenBox 写入 `core.log`，不使用 `log.output`。
- 每天零点由定时任务（服务运行期间写入 `/etc/crontabs/root`）把前一天的内容追加到 `app-YYYY-MM-DD.log`、`core-YYYY-MM-DD.log` 并清空当前文件；服务启动时也会补做一次。采用“复制后清空”，sing-box 无需重启。
- `logs.auto_clean` 开启时，删除超过 `logs.retention_days` 天的旧日志。
- 日志在内存中，路由器重启后清空。
- 界面只显示当天的日志；之前日期的文件只在后台保留，供命令行查看。界面上的「清空」只清空显示：之后只显示点击后新写入的内容，日志文件不受影响。

### 3.3.2 接管与 DNS

打开接管后：

1. **连接**：
   - **TUN**：`auto_route` + `auto_redirect` 接管局域网设备和路由器自身的流量，规则由 sing-box 设置。保留地址（`route_exclude_address`，默认值与 TProxy 的 `bypass_address` / `bypass_address6` 相同）和国内 IP（`route_exclude_address_set`）在防火墙层直接绕过。
   - **TProxy**：OpenBox 用 `firewall.uc` 生成 `inet openbox` 表：局域网接口进来的 TCP/UDP 打上 `mark` 交给 TProxy 端口；路由器自身的流量在 output 打标记后经策略路由（`local default dev lo`）回到本机再交给 TProxy；sing-box 自己的连接带 `output_mark`，不被接管；保留地址和本地规则集里的地址在 nft 集合中直接绕过。DNS：局域网和路由器自身发往 53 端口的查询重定向到 `dns-in`；路由器自己的查询重定向到回环地址后源地址仍是 WAN 地址，sing-box 监听全部地址、会从该地址应答，与重定向对不上，所以在 postrouting 把它们的源地址改为 `127.0.0.1` / `::1`。fw4 重启不受影响。是否设置、TProxy 和 DNS 端口、sing-box 自己的标记都取自 sing-box 正在运行的配置：新配置没通过检查、继续运行旧配置时，规则与旧配置一致。
   - **随 sing-box 存亡**：procd 运行的是 `run.sh`，它在 sing-box 启动后设置规则，sing-box 一退出（崩溃或停止）立即删除，procd 重启 sing-box 时再设置。sing-box 反复崩溃、procd 放弃重启时，规则已经删除，流量直连，不会断网。
   - **TUN 也一样**：sing-box 正常退出时会自己撤掉 TUN 的规则，但崩溃或被杀时会留下 `inet sing-box` 表和策略路由，让路由器断网。`run.sh` 在 sing-box 启动前和退出后清理这些残留：路由表、优先级和标记取自运行配置的 TUN 入站（没写的用 sing-box 的默认值），逐条删除能对上的规则（规则优先级起的 4 个优先级里带这些标记、查这张表、`goto` 或 `nop` 的；回退优先级里查这张表的；优先级 1 上 `auto_redirect` 为重定向路由加的、查一张随机编号路由表的那条），不按优先级整个清空，别人的规则不受影响。
   - **DNS 缓存**：sing-box 退出时 dnsmasq 恢复原来的上游并重启，缓存随之清空，避免 FakeIP 残留。
   - **IPv6**：默认只接管 IPv4：DNS 解析策略为 `ipv4_only`，设备拿不到 IPv6 地址；TProxy 拒绝局域网和路由器自身发往公网的 IPv6 TCP/UDP（`bypass_address6` 中的地址除外），客户端回退到 IPv4；TUN 只有 IPv4 地址时 sing-box 不处理 IPv6。
   - **IPv6 接管**（接管页的 IPv6 开关）：同时设置 `firewall.ipv6 '1'`、`dns.strategy 'prefer_ipv4'`，并给 TUN 加 IPv6 地址（默认 `fdfe:dcba:9876::1/126`，sing-box 示例值；关闭时去掉 TUN 的 IPv6 地址、改回 `ipv4_only`）。TUN 有了 IPv6 地址，sing-box 自己接管 IPv6 路由和 DNS，规则集的 IPv6 部分（`cn-mainland-ip` 含 3534 条 IPv6）随 `route_exclude_address_set` 生效。TProxy：`firewall.uc` 不再生成拒绝 IPv6 的链，改为 `tproxy ip6` 接管，`bypass6` 集合加上规则集的 IPv6 地址（全局模式除外），并设 `ip -6` 策略路由。FakeIP 用 IPv6 地址段 `2001:2::/48`。RealIP 模式下节点需要能访问 IPv6 目标；FakeIP 模式下由节点解析域名，不受影响。
   - **接口**：启动时按 ubus 状态取局域网接口的设备，接口未就绪时用 network 配置中的 `device`；接口 up 时 hotplug 重新设置规则。
   - 两种方式下，内网地址直连，其余按路由规则和出站模式处理。
   - **全局代理模式**：国内 IP 也走代理，防火墙层不再绕过规则集（保留地址仍直连）。出站模式在活动页选择，选中即写入 `main.mode` 并重载 OpenBox，不用保存并应用（不改 `clash_api.default_mode`：sing-box 把它当作一个独立的模式提供，改掉后「规则判定」会从可选模式中消失）。生成器和 `firewall.uc` 据此决定是否绕过。应用时 sing-box 不重启的，`mode.uc` 经 clash API 设置模式，TProxy 的防火墙规则有变化才重设；TUN 进出全局模式时配置改变，sing-box 重启（现有连接断开）。sing-box 把模式存在缓存文件里，启动时优先用缓存的模式，所以 `run.sh` 在每次启动后也设置一次。可选的模式按配置算：默认模式加上规则里出现的 `clash_mode`，OpenBox 没运行时也能选。
2. **DNS**：发往外部 53 端口的查询（包括设备写死的 8.8.8.8）都由 sing-box 应答（TUN 由 sing-box 劫持，TProxy 由 OpenBox 重定向到 `dns-in`），sing-box 能看到是哪台设备在查询；问路由器（dnsmasq）的查询由 dnsmasq 转给 `dns-in`（见第 3 点）。本地域名和私有网段的反查转给 dnsmasq，DHCP 主机名照常可用；其余先问国内 DNS，国内 IP 原样返回，其他按 DNS 模式处理：
   - **FakeIP**（默认）：立即返回假地址，连接时由节点解析域名。快、分流准；应答的 TTL 为 1 秒（与 mihomo 的 fake-ip 相同），设备几乎不缓存假地址，停止服务后下一次查询就拿到真实地址。假地址由 sing-box 在本地分配，查询变多几乎没有开销；自带 DNS 缓存的程序（如 Java 默认缓存 30 秒）仍要等它自己的缓存过期。
   - **RealIP**：经代理向远程 DNS 再查一次，返回真实地址。首次访问稍慢，所有应用都能正常使用，停止后不留假地址。
   - 两种模式只差 `dns_rule 'foreign'` 和 `'fallback'` 的 `server`（`fakeip` 或 `cloudflare`，之前的配置里是 `remote`）和 `rewrite_ttl`（FakeIP 为 1，RealIP 不设）；接管页的「DNS 模式」同时修改这两处。
3. **dnsmasq 转发给 sing-box**：dnsmasq 的上游常是私有地址（主路由、光猫），TUN 不接管路由器发往私有地址的查询，路由器自己和问 dnsmasq 的设备就会绕过 sing-box、拿到真实地址。所以 sing-box 运行期间，`run.sh` 在每个 dnsmasq 实例的 conf-dir（默认 `/tmp/dnsmasq.<实例>.d`）写入 `openbox.conf`：`no-resolv` 加 `server=127.0.0.1#<dns-in 端口>`，然后重启 dnsmasq；dnsmasq 仍负责 DHCP、本地域名和私有网段的反查（`local=/lan/`、`boguspriv`，OpenWrt 默认开启，sing-box 的 `local` 服务器经它解析这些名字，不会循环），其余查询交给 sing-box。sing-box 一退出（崩溃或停止）就删掉这些文件并重启 dnsmasq，恢复原来的上游；写过的文件记在 `/var/run/openbox/dnsmasq.state`，`/etc/config/dhcp` 不改动。运行的配置里没有 tag 为 `dns-in` 的 `direct` 入站（例如原生 JSON 没写）时不做转发。
4. **停止后**：sing-box 撤掉 TUN、路由规则和 nft 表，dnsmasq 回到原来的上游，国内网络立即恢复。

### 3.3.3 升级

`/etc/config/openbox` 是配置文件，升级时保留，默认值的改动不会自动出现在老用户的配置里。`main.config_version` 记录配置格式的版本；软件包附带的 uci-defaults 脚本在每次安装或升级时运行 `migrate.uc`，按版本逐级执行迁移步骤（例如补上新增的 section），最后把版本号更新到最新。新安装的配置已是最新版本，不执行任何步骤。改动默认值时，必须同时加一个迁移步骤。基线版本（见 3.1）从版本 1 重新开始，之前的步骤不再保留。

### 3.3.4 订阅更新

订阅是一个返回完整 sing-box JSON 配置的 URL，记在订阅配置的包里（`config profile 'profile'` 的 `url`、`update_interval`、`user_agent`，以及由脚本写入的 `last_update`、`last_error`），下载后存为 `/etc/openbox/subscriptions/<标识>.json`，生成时只取其中的节点（见 3.1）。新建时立即下载，第一次下载失败就不保留这份配置。不做 Clash 格式、分享链接或 base64 转换。更新由 `/usr/share/openbox/subscription.sh` 完成（`update <file>` 更新一个，`due` 更新到期的）：

- **下载**：`uclient-fetch`，超时 30 秒（页面上手动更新时 10 秒，LuCI 的调用 20 秒超时）；UA 用配置里的 `user_agent`，不写时为 `sing-box/<内核版本> OpenBox/<插件版本>`（没装内核时只有 OpenBox 部分），让订阅服务端返回 sing-box 格式。
- **校验**：必须是 JSON 对象，且通过 `sing-box check`（没装内核时跳过检查）；任何一步失败都不动原文件，原因写进 `last_error`。
- **替换**：内容与原文件相同时不写闪存、不重载；否则先复制到同目录的临时文件，再改名原子替换。成功后写 `last_update`、删掉 `last_error`。
- **使用中则重载**：`main.profile` 正是这份配置，并且服务在运行，就执行 `/etc/init.d/openbox reload`。
- **定时**：服务运行期间，`/etc/crontabs/root` 里带 `#openbox` 标记的一行每小时（第 30 分）执行 `subscription.sh due`，与日志轮转一起随服务启停写入、删除；所以 **OpenBox 停止时订阅不会自动更新**。距 `last_update` 达到 `update_interval`（留 5 分钟余量，避免每小时的检查刚好差几秒）或从未更新过的才下载。
- 同一时间只有一次更新（`flock`）；页面上手动更新时如果正有更新在进行，提示稍后再试。输出同时写进插件日志 `app.log`。下载失败不影响正在运行的服务。
- 在配置文件页添加订阅时先下载一次；第一次就失败的新订阅不保存。已有同名的普通文件时报错，不会把它变成订阅。删除文件时一并删除它的订阅。

### 3.4 组件

```
LuCI JS 界面（form.Map 直接读写 UCI）
   │ ubus / rpcd
   ▼
rpcd ucode 插件（luci.openbox）：状态、内核安装、可选的出站模式、组的当前节点和延迟（经 clash API）；配置的列表、新建（复制模板）、查看（生成的 JSON）、删除、切换
   │
   ▼
/etc/init.d/openbox（procd）
   ├─ generate.uc（设备设置 + 当前配置包，OPENBOX_PROFILE 可指定别的配置）→ /var/run/openbox/config.json
   ├─ sing-box check
   ├─ mode.uc（重载时 sing-box 不重启）← 经 clash API 设置出站模式
   └─ run.sh → sing-box run           ← TUN 接管的规则由 sing-box 设置
        ├─ firewall.uc（运行的配置有 TProxy 入站时）→ nft -f -   ← 独立的 inet openbox 表与策略路由，随 sing-box 退出而删除
        └─ mode.uc                     ← sing-box 启动后设置出站模式
```

参考：ImmortalWrt 的 homeproxy 同样用 UCI 加 ucode 生成 sing-box 配置（GPL-2.0），只参考其结构，不复用代码。

### 3.5 目录

```
openbox/
├── openbox/
│   ├── Makefile
│   └── files/
│       ├── openbox.conf        # /etc/config/openbox 默认值（设备设置）
│       ├── template/openbox_template  # 新建配置的模板，复制为 /etc/config/openbox_<标识>
│       ├── openbox.init
│       ├── openbox.hotplug     # 接口 up 时刷新 TProxy 规则
│       ├── openbox.uci-defaults  # 升级时运行 migrate.uc；首次安装时由模板创建 openbox_default
│       ├── run.sh              # procd 运行它，它运行 sing-box 并管理 TProxy 规则
│       ├── common.sh
│       ├── core-install.sh
│       ├── subscription.sh     # 下载、检查并替换订阅的内容（subscriptions/<标识>.json）；cron 每小时执行 due
│       ├── rule-set/           # 国内 IP 规则集（来自 cosxs/cn-mainland-ip）
│       └── ucode/              # generate.uc、firewall.uc、migrate.uc、mode.uc、inspect.uc；
│                               # clash.uc、config.uc、profile.uc 为共享模块，装到 /usr/share/ucode/openbox/
├── luci-app-openbox/
│   ├── Makefile
│   ├── htdocs/…/view/openbox/  # 各页面
│   ├── htdocs/…/openbox/       # ui.js：各页面共用（section 查找与选项、校验、时长等）；fields.js：sing-box 字段的
│   │                           # JSON 输入框及与表单字段的双向绑定（节点 TLS、拨号，HTTP 客户端 TLS、拨号共用），
│   │                           # 以及规则 JSON 的校验；
│   │                           # policy/：策略页节点弹窗，common.js 放协议常量与校验，
│   │                           # general、tls、transport、multiplex、quic、dial 各对应弹窗的一个标签页；
│   │                           # rules/：路由规则页，condition.js 是「规则类型 + 值」（类型表、表格显示、
│   │                           # 弹窗字段），标准规则和子规则共用；logical.js 是逻辑规则（弹窗两个标签页的切换、
│   │                           # 子规则表格和叠放弹窗），依赖 LuCI 弹窗内部行为的处理都集中在这里
│   ├── root/usr/share/rpcd/    # ACL、ucode 插件
│   └── po/
├── docs/
└── .github/workflows/
```

### 3.6 界面

| 页面 | 内容 |
| --- | --- |
| 活动 | 运行状态、配置来源、接管方式、出站模式（单选切换，选中立即生效；配置里只有一种模式时只显示名称，未启用 clash API 时不显示）、已运行时长（天、时、分）、内核版本、插件版本；启动 / 停止 / 重载；内核安装与更新；sing-box 自带服务在用时提示并提供「由 OpenBox 接管」 |
| 接管 | 启用、接管方式（TUN / TProxy）、DNS 模式（FakeIP / RealIP），FakeIP 时显示它的 IPv4 / IPv6 地址段；IPv6 开关（默认关闭）；TUN：接口名称、地址、MTU、绕过的规则集、绕过的 IPv4 地址、绕过的 IPv6 地址（同一个 `route_exclude_address` 按地址族拆开显示，保存时合并）；TProxy：TProxy 端口、DNS 端口、局域网接口、绕过的规则集、绕过的 IPv4 地址、绕过的 IPv6 地址；代理端口（mixed 入站）：启用、端口、用户名、密码，与接管互相独立，活动页在启用时显示端口 |
| 策略 | sing-box 的出站都在这里，只有策略组和节点，「添加」按钮在各自列表底部（LuCI 默认位置）。策略组列表：名称、类型、当前出站（参考 Surge：点击弹出菜单，列出全部成员及 sing-box 测得的延迟，手动选择组在此切换；「延迟测试」经 clash API 的 `/group/{name}/delay` 一次并发测完全部成员，测速地址和超时取插件设置，无响应的显示为超时，延迟按 <300 ms / <800 ms / 更高分绿、橙、红三色），增删改（名称、类型、出站标签、默认出站、自动测速参数和闲置超时、中断现有连接；出站标签用 LuCI 原生的动态列表，可拖动排序，生成时按这个顺序，下拉框按节点（含订阅节点）、Direct、策略组排列；保存时提示循环引用并拦截：列出的组若已直接或经其他组包含本组，列表标红并提示「在策略组中发现了循环引用：<组名>」（参考 Surge），不能保存，判断与生成器的防环一致，默认出站也不列出这样的成员）；全局代理模式时，全局模式路由规则指向的组（默认隐藏的 Global）显示在列表第一行，只能切换当前出站，不能编辑、删除或拖动；sing-box 未运行时当前出站显示「未运行」，新加的组显示「保存并应用后生效」；节点列表：名称、协议、服务器、延迟（任一组测得的结果），上方有「延迟测试」（测 Global 组即测全部节点），不能拖动排序，增删改，按协议显示对应字段（凭据、TLS / Reality、传输方式）；订阅配置的节点列表改为只读列出订阅的节点（经 `subscription_nodes`），只能测试延迟。当前出站立即生效，其余保存并应用后生效 |
| 路由规则 | 从上到下平铺三块：路由设置、规则、规则集。规则：结构参考 Surge，一条规则一个条件；列表为启用、类型、值、动作、注释，从上到下匹配，拖动调整顺序；新规则排在最前（固定规则之后）。弹窗：规则类型（下拉，直接是 sing-box 路由规则的字段名：domain、domain_suffix、domain_keyword、domain_regex、rule_set、ip_cidr、ip_is_private、source_ip_cidr、source_ip_is_private、source_mac_address、source_hostname、port、port_range、source_port、source_port_range、network、protocol、inbound、ip_version、auth_user）和它的值（随类型变化，下方一句说明；ip_is_private 这类布尔字段不用填值；弹窗分「标准规则」「逻辑规则」两个标签页（参考 Surge 的标准规则和 AND/OR 规则），保存时停在哪个标签页，规则就是哪种（逻辑规则写入 `type 'logical'`，不留自己的匹配条件；标准规则不留 `mode`、`id` 和子规则）；动作、出站、拒绝方式、反向匹配、注释两个标签页各有一份，切换时带过去，保存时只写当前这份；编辑已有规则时打开在它那种的标签页；启用只在表格里切换；逻辑规则填模式 and / or 和子规则：子规则是标签页里嵌的 LuCI 原生表格（参考 Surge 的子规则表格），列出类型和值，可增删、拖动排序；添加或编辑时叠一层弹窗，和标准规则一样左边选规则类型、右边填值，另有反向匹配，类型多一个「JSON」，写类型表达不了的（多个条件、嵌套 logical）；打开子规则弹窗前先保存逻辑规则这一层（LuCI 叠放弹窗的做法），逻辑规则第一次加子规则时生成 `id`；删除逻辑规则、取消新建的逻辑规则或把它改成标准规则时，它的子规则一起删除；子规则只写匹配条件，动作用外层这条规则的；表格里照 Surge 的写法一行显示：类型为 AND / OR，值为子规则的表达式，如 `((domain_suffix,netflix.com), (NOT,((port,443))))`，反向的子规则包一层 NOT，JSON 写的也换成这种写法；子规则表格里 JSON 的值同样这样显示）、反向匹配（invert）；动作：route（选策略组或节点）或 reject（method：default / drop）；注释（`comment`，不生成）。手写的多条件规则显示为「多个条件」，弹窗里只改动作和注释，条件保持原样。嗅探、DNS 劫持、内网直连和全局 / 直连模式这 5 条固定规则带 `hidden`，不显示。规则集：增删改（标签、类型：远程 / 本地文件 / 内联；格式：按扩展名 / 二进制 / 源文件；远程：URL、初始文件、下载方式、更新间隔；本地：路径；内联：规则，sing-box 无头规则的 JSON 数组），弹窗添加，不用先填 section 名；DNS 规则和接管页的绕过规则集也引用这里的规则集。路由设置：按 sing-box 文档顺序列出路由器用得上的 `route` 字段：默认出站 `final`、邻居解析 `find_neighbor`、DHCP 租约文件 `dhcp_lease_files`、默认 HTTP 客户端 `default_http_client`（留空时 sing-box 用第一个 HTTP 客户端，空选项据此显示「第一个 HTTP 客户端」；一个都没定义时显示「未定义 HTTP 客户端」，这时会经默认出站下载，1.14 已废弃、1.16 移除；规则集的「下载方式」和 Hysteria2 realm 的「HTTP 客户端」留空则跟随这里，空选项显示「默认 HTTP 客户端」）、默认域名解析服务器 `default_domain_resolver`（只列直连、且不是 local 的 DNS 服务器：节点连上之前要靠它解析自己的服务器域名，走代理的会卡死，local 会绕回 sing-box）；不列出 `auto_detect_interface`（生成器总是开启）、`default_interface`、`find_process`、多网卡策略（`default_network_strategy`、`default_network_type`、`default_fallback_network_type`、`default_fallback_delay`），以及 OpenBox 在 TProxy 时自动设置的 `default_mark`（取防火墙的 `output_mark`） |
| 设备 | 访问控制模式与设备列表 |
| 内核设置 | 二级标签依次为：日志（级别、时间戳）、DNS（默认服务器（不列出 local：OpenBox 运行时 dnsmasq 把查询交回 sing-box，没命中规则的查询会绕回来）、解析策略、乐观缓存、DNS 服务器列表（不显示 FakeIP 和内置的 local；类型按官方文档写作 TCP、UDP、TLS、QUIC、HTTPS、HTTP/3）、DNS 规则（子标题下一个输入框，填 sing-box 原生 JSON 数组，保存时检查 JSON 格式））、NTP（启用、服务器、端口、同步间隔、出站）、HTTP 客户端（顶层 `http_clients` 的列表；弹窗和节点一样分标签页：基本（标签、HTTP 版本 1 / 2 / 3、禁用版本回退、请求头）、HTTP2（版本 2 时显示）、QUIC（版本 3 时显示，含 HTTP2 字段）、TLS（TLS 字段 JSON）、拨号（固定显示出站 `detour` 和域名解析服务器 `domain_resolver`，按 tag 选择，与下方拨号字段 JSON 双向同步，只存 JSON；选了出站时 sing-box 忽略其他拨号字段，域名解析服务器随之隐藏）；供路由规则页的默认 HTTP 客户端、规则集的下载方式和 Hysteria2 realm 选用）、实验性（clash API 监听地址和密钥、缓存文件；默认出站模式不在界面上提供）。只用于生成配置；配置来源为原生 JSON 时不生效 |
| 配置文件 | 一张表列出全部配置：配置名（点击查看；订阅上次更新失败时下面一行红字写原因）、类型（本地 / 订阅）、使用中标签；操作列只有「使用」（使用中的不显示）和「更多」菜单——本地：查看、删除；订阅：查看、更新、删除（使用中的不显示删除）。「查看」在弹窗里只读显示生成的 JSON（两个空格缩进）。「新建…」弹窗：配置名、来源（默认配置 / 远程订阅），远程订阅再填订阅地址、更新间隔（小时）和 User-Agent |
| 日志 | 日志设置（自动清理、保留天数）；插件日志和内核日志 |
| 插件设置 | OpenBox 自己的设置，按子标签分组。测速：测速地址、测速超时 |

设置放在用户处理那件事时会去找的页面上；很少改、偏技术的 sing-box 全局设置放进「内核设置」。

所有页面顶部依次是「OpenBox」和一句简介、OpenBox 的标签栏，和系统页一样标题在上、标签在下。菜单里各子页面不设标题，主题就不画它们的标签；标签栏由各页用 LuCI 原生的 `cbi-tabmenu` 画在标题下面（`openbox/ui.js`），窗口标题由它补上页面名。「服务 → OpenBox」直接打开活动页。不为某个主题单独适配；原来各页的说明放进各自第一个分组。

有单位的输入框在框后显示固定单位，只填整数：测速间隔、闲置超时、NTP 同步间隔（分钟），规则集更新间隔（小时），容差（毫秒），日志保留（天）。时长按单位换成 sing-box 的写法保存（填 3 存 `3m`）；UCI 里已有的其他写法（如 `90s`）原样显示和保留。

目前菜单只放已有内容的页面：活动、接管、策略、路由规则、内核设置、配置文件、日志、插件设置；设备页（访问控制）做好后再加入。服务的启用也在活动页完成（「启用」按钮）。

## 4. 环境要求

- OpenWrt 25.12（fw4，apk）
- 依赖：`kmod-tun`、`kmod-nft-queue`（`auto_redirect` 的预匹配用到 nfqueue）、`kmod-nft-tproxy`（TProxy）、`kmod-inet-diag`、`ca-bundle`、`ip-full`、`ucode-mod-socket`（经 clash API 设置出站模式，界面也用）
- sing-box ≥ 1.14：不随软件包安装，也不使用 OpenWrt 软件源的版本。系统里已有符合版本的 `/usr/bin/sing-box`（官方包或固件自带）时直接使用，不需要另装；否则由用户在 OpenBox 页面中从 GitHub 安装最新版，或上传官方发布页的 `sing-box_*_openwrt_<架构>.apk`。官方构建安装后约占 90 MB 存储。
- sing-box 包自带的服务（`/etc/init.d/sing-box`）：OpenBox 自己运行 sing-box。自带服务只是装着、不运行时（未运行，且没有同时开启开机自启和 `sing-box.main.enabled`），OpenBox 直接使用；自带服务正在运行或会开机运行时，OpenBox 不启动，活动页提示冲突并提供「由 OpenBox 接管」，点击后才停止并禁用自带服务、启用并启动 OpenBox。从 OpenBox 安装内核属于手动操作，新装包的自带服务会直接禁用。卸载 OpenBox 后不会自动恢复。

## 5. 项目信息

- 名称：`openbox`
- License：GPL-3.0
