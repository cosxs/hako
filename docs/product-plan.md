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
| 节点 | 手动添加、编辑、删除。支持 Shadowsocks、VMess、VLESS（含 Reality）、Trojan、Hysteria2、Hysteria（两者都可端口跳跃）、TUIC、AnyTLS、ShadowTLS、NaiveProxy、Snell（v4/v5、v6）、WireGuard（生成为 endpoint）、SSH、SOCKS、HTTP；每个节点可设前置节点（`detour`），ShadowTLS 即作为其他节点的前置节点使用，不会被“包含全部节点”加入策略组。Tor（需另装 tor）、bridge（三层转发）不做 |
| 策略组 | 手动选择或自动测速；成员可以是“全部节点”、按名称正则筛选的节点，再加上指定的其他组；手动选择可设默认出站，自动测速可设闲置超时，两者都可设切换时中断现有连接；运行时可切换当前选择 |
| 出站模式 | 规则判定 / 全局代理 / 直接连接，运行时切换；全局代理时国内 IP 也走代理 |
| 透明代理 | 一个总开关，接管局域网和路由器自身的流量。接管方式二选一：TUN（sing-box 的 `auto_route` + `auto_redirect`，规则由 sing-box 设置）或 TProxy（OpenBox 设置 nft 规则和策略路由）；DNS 由 sing-box 应答，本地域名交还 dnsmasq；默认只接管 IPv4，可开启 IPv6 接管 |
| 访问控制 | 按设备（IP 或 MAC）设置黑名单或白名单 |
| 绕过与分流 | 内网和保留地址始终直连；国内 IP 用自带的规则集在防火墙层绕过；DNS 先问国内 DNS，国内 IP 原样返回，其余返回 FakeIP 并由节点解析 |
| 配置文件 | 管理 `/etc/openbox/profiles/*.json`（新建、上传、编辑、检查、下载、删除），选用时原样运行，不经过生成器；也可以查看生成的配置 |
| 日志 | 日志设置在页面上方：自动清理（默认开启）、保留天数（默认 7 天）、内核日志级别；下方插件日志和内核日志分两个标签，只显示当天的日志并自动刷新，「清空」只清空显示、不删除文件；后台按天保存，每天零点轮转 |

**M1 不做**（之后再定）：分享链接导入、订阅、redirect 接管模式、自定义 JSON 片段（DNS 规则除外）。

**完成标准**：在 x86_64 虚拟机和一台 arm64 真机上，只用表单添加一个节点就能跑通透明代理；访问控制生效；停止服务后路由、nft 规则和 DNS 都恢复原状。

## 3. 设计

### 3.1 两种配置来源

| 来源 | UCI | 运行的配置 | 接管方式 |
| --- | --- | --- | --- |
| 生成（默认） | `option source 'model'` | 由 UCI 生成 | 启用的 `config inbound 'tun'` 或 `'tproxy'`，加上 `'dns_in'` |
| 原生 JSON | `option source 'profile'`，`option profile 'x.json'` | `/etc/openbox/profiles/x.json` 原样使用 | 读取配置里的入站：`tun`、`tproxy`、`redirect`，以及 tag 为 `dns-in` 的 `direct` |

两种来源最后都复制到 `/var/run/openbox/config.json`，经 `sing-box check` 后运行。原来的内置只读配置 `builtin:default.json` 不再需要，由“没有节点时的生成结果”取代。

> **技术验证结论**（OpenWrt 25.12 容器，sing-box 1.14.3）：`tun` 入站的 `auto_route` + `auto_redirect` 能接管局域网设备和路由器自身的流量。TCP 经 nftables 重定向，UDP 经策略路由进入 TUN；sing-box 自建 `inet sing-box` 表，与 fw4 互不影响，重启防火墙不丢接管，停止后清理干净。节点不可用时流量不会泄露为直连。TProxy 由 OpenBox 自建 `inet openbox` 表和策略路由，同样逐项验证通过。

### 3.2 数据模型（`/etc/config/openbox`）

原则：**所有配置都来自 UCI**，生成器里不写任何具体的值，只负责翻译和必要的计算。

命名约定：
- **能用 sing-box 的就以 sing-box 为准**：section 类型是 sing-box 的顶层键（数组元素用单数，如 `outbound`、`route_rule`），section 名是下一层的键或元素的内部标识，option 沿用 sing-box 字段名，嵌套字段用 `_` 连接（`tls.server_name` → `tls_server_name`）。
- **OpenBox 自己加的概念参考 mihomo 命名**：`include_all_proxies`、`include_all_groups`、`filter`、`exclude_filter`、`hidden`。
- 引用（`outbounds`、`default`、`final`、`outbound`、`detour`、`server`、`domain_resolver`、`default_domain_resolver`、`rule_set`、`route_exclude_address_set`、`http_client`）可以写 section 名或 tag，先按 section 名查找。
- 拨号字段 `detour` 不能指向 direct 类型的出站（sing-box 会报错），生成时忽略并给出警告；留空就是直连。
- 生成器按字段类型表转换布尔、数字和列表；表中没有的 option 会被跳过并给出警告。

下面是软件包附带的默认值，加上若干示例：

```
config openbox 'main'              # OpenBox 自身的设置
	option config_version '12'      # 配置格式的版本，升级时由迁移脚本逐级更新（2：加入 mixed 入站；3：固定的路由规则标 hidden；4：local 改为 local 类型，AliDNS 改名 alidns；5：FakeIP 加 IPv6 地址段；6：绕过的 IPv6 地址 fc00::/7 改为 fd00::/8；7：删掉 dnsmasq 服务器，局域网域名改用 local；8：拒绝 QUIC 改按嗅探到的协议；9：开启 find_neighbor；10：TUN 接管也启用 dns_in，供 dnsmasq 转发；11：FakeIP 的 IPv6 地址段 fc00::/18 改为 2001:2::/48；12：FakeIP 应答的 TTL 改为 1 秒）
	option enabled '0'
	option source 'model'          # model | profile
	option profile ''              # source 为 profile 时使用的文件
	# option mode 'Global'         # 出站模式：在策略页选择，保存并应用后由 OpenBox 经 clash API 设到 sing-box；
	                               # 也决定国内 IP 是否在防火墙层绕过；没有时取 clash_api.default_mode

config openbox 'logs'              # OpenBox 的日志管理
	option auto_clean '1'          # 自动清理按天保存的旧日志
	option retention_days '7'      # 保留天数（含当天）

config log 'log'                   # → log
	option level 'warn'            # info 及更低级别会为每个连接记录日志
	option timestamp '1'

config dns 'dns'                   # → dns
	option final 'remote'          # 规则都没命中时用的 DNS 服务器
	option strategy 'ipv4_only'    # 只解析 IPv4；开启 IPv6 接管时为 prefer_ipv4
	option optimistic '1'          # 乐观缓存：过期先返回旧结果，后台刷新
	# option custom_rules '[...]'  # OpenBox：sing-box 原生 DNS 规则的 JSON 数组，原样插到下面局域网域名规则之后、
	                               # 国内外分流（evaluate 开始）之前；内核设置 → DNS 里编辑，不经字段转换，官方字段都能用

config dns_server 'local'          # → dns.servers[]；系统解析（OpenWrt 上经 /etc/resolv.conf 交给 dnsmasq），解析局域网域名
	option tag 'local'
	option type 'local'            # local | udp | tcp | tls | quic | https | h3 | fakeip；界面列表不显示 local 和 fakeip，
	                               # 其余按官方文档显示为 UDP、TCP、TLS、QUIC、HTTPS、HTTP/3

config dns_server 'alidns'         # 国内 DNS（阿里 DNS），直连
	option tag 'alidns'
	option type 'udp'
	option server '223.5.5.5'      # 其余字段：server_port、path、tls_server_name、
	                               # detour（出站）、domain_resolver（DNS 服务器）

config dns_server 'fakeip'         # 在「接管」页随 DNS 模式设置，内核设置的 DNS 服务器列表里不显示
	option tag 'fakeip'
	option type 'fakeip'
	option inet4_range '198.18.0.0/15'
	option inet6_range '2001:2::/48' # 基准测试地址段（RFC 5180），与 IPv4 的 198.18.0.0/15 对应；不用 sing-box 示例的 fc00::/18：dnsmasq 的重绑定保护会丢弃 fc00::/7 的应答；dns.strategy 为 ipv4_only 时用不到

config dns_server 'remote'         # 经代理的 DoH，兜底
	option tag 'remote'
	option type 'https'
	option server '1.1.1.1'
	option detour 'proxy'

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
	option default_mode 'Rule'     # 固定为 Rule，界面不提供；实际模式由策略页的出站模式（main.mode）决定

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
	option final 'proxy'
	option default_domain_resolver 'alidns'  # 解析节点域名用的 DNS 服务器，必须直连
	option auto_detect_interface '1'        # 出站绑定物理网卡，接管时避免回环
	option find_neighbor '1'                # 日志显示局域网设备的 MAC 和主机名（内核设置 → 日志 →「显示设备」）
	# list dhcp_lease_files ''              # 默认不写：sing-box 自动探测 /tmp/dhcp.leases（OpenWrt 的 dnsmasq）等租约文件
	# option default_http_client ''         # 远程规则集默认的下载方式

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

config http_client 'via_proxy'     # 示例 → http_clients[]，供远程规则集下载
	option tag 'via-proxy'
	option detour 'proxy'

config outbound 'direct'           # → outbounds[]
	option tag 'Direct'
	option type 'direct'
	option hidden '1'              # mihomo：不在策略页的策略组、节点列表中显示，仍可在各处选用

config outbound 'hk01'             # 节点示例
	option tag '香港 01'
	option type 'vless'            # direct | shadowsocks | vmess | vless | trojan | hysteria2 | hysteria | tuic | anytls
	                               # | shadowtls | naive | snell | wireguard | ssh | socks | http
	option server 'example.com'
	option server_port '443'
	option uuid '…'
	option tls_enabled '1'         # 其余字段：password、method、flow、tls_server_name、
	…                              # tls_insecure、tls_alpn、tls_utls_fingerprint、
	                               # tls_reality_enabled/public_key/short_id、
	                               # transport_type/path/host/service_name、obfs_type/password；
	                               # snell：version、psk、reuse、obfs_mode/host（v4）、mode（v6）；
	                               # socks：version、username、udp_over_tcp；http：username、path；
	                               # vmess：uuid、security、alter_id、packet_encoding，可用 tls 与 transport；
	                               # hysteria：auth_str、obfs、up_mbps、down_mbps；hysteria 与 hysteria2 另有
	                               # server_ports、hop_interval（设置后不输出 server_port）；
	                               # tuic：uuid、password、congestion_control、udp_relay_mode、zero_rtt_handshake；
	                               # anytls：password；shadowtls：version、password；naive：username、password、quic；
	                               # ssh：user、password、private_key_path、private_key_passphrase、host_key；
	                               # wireguard → endpoints[]：private_key、address、mtu，服务器即唯一的 peer，
	                               # peer_public_key、peer_pre_shared_key、peer_allowed_ips（留空为全部）、
	                               # peer_reserved（如 "1,2,3"）、peer_persistent_keepalive_interval；
	                               # vmess、hysteria、tuic、snell、socks 另有 network；
	                               # 所有节点可设 detour（前置节点，节点或策略组）

config outbound 'proxy'            # 策略组也是 outbound
	option tag 'Proxy'
	option type 'selector'         # selector | urltest
	option include_all_proxies '1' # mihomo：包含全部节点（不含 direct 类型）
	list   outbounds 'direct'      # sing-box：明确列出的成员
	option default ''              # sing-box：selector 的默认出站，必须是成员，否则忽略并警告；留空用第一个成员
	option interrupt_exist_connections '0'  # sing-box：当前出站改变时中断现有连接（两种组都可用）

config outbound 'global'           # 全局模式使用的组
	option tag 'Global'
	option type 'selector'
	option hidden '1'
	option include_all_groups '1'  # 包含其他所有未设置 include_all_groups 的组
	option include_all_proxies '1'
	list   outbounds 'direct'

config outbound 'hk'               # 示例：自动测速，只取名称含“香港”的节点
	option tag '香港'
	option type 'urltest'
	option include_all_proxies '1'
	option filter '香港'           # mihomo：筛选 include_all_proxies 带入的节点
	option exclude_filter ''       # mihomo：排除匹配的节点
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
| 出站 | 每个启用的 `outbound` 一个出站。策略组的成员顺序：`outbounds` 中的组 → `include_all_groups` 的组 → `include_all_proxies` 带入并经 `filter` / `exclude_filter` 筛选的节点 → `outbounds` 中的节点 |
| 入站 | 启用的 `config inbound`：`tun`，或 `tproxy` 加 `direct`（DNS）；另有可单独启用的 `mixed`（代理端口，`username` / `password` 生成为 `users`）；启用 TProxy 时 `route.default_mark` 取 `firewall.output_mark`。都关闭时不生成入站，sing-box 只提供出站模式和组切换 |
| 路由规则 | `config route_rule` 按顺序生成；默认动作 `route` 必须有有效的 `outbound`，否则跳过并警告；`hidden` 只用于界面，不生成；`final` 取 `route.final` 指向的节点或组 |
| 规则集 | `config rule_set` → `route.rule_set`；`config http_client` → `http_clients`，供远程规则集下载 |
| clash API | 存在 `config experimental 'clash_api'` 时生成 |
| DNS | `config dns 'dns'` 加上所有 `config dns_server` 和按顺序的 `config dns_rule`；发往服务器的动作（`route`、`evaluate`）必须有有效的 `server`；`dns.custom_rules`（JSON 数组）原样插到第一条 `evaluate` 规则之前，JSON 无效时跳过并警告；规则里的 `strategy` 已被 sing-box 1.14 弃用，不再生成 |
| NTP | `config ntp 'ntp'`；默认关闭，路由器时钟不可靠时再开启 |
| 缓存文件 | 存在 `config experimental 'cache_file'` 时生成；默认放在闪存上，路由器重启和系统升级后仍保留出站模式、各组的选择和 FakeIP 映射 |

默认配置（没有节点）生成的结果：`Direct`、只含 `Direct` 的 `Proxy`、包含 `Proxy` 和 `Direct` 的 `Global`；DNS 分流和路由规则；国内 IP 规则集；clash API 和缓存文件。接管默认开启（TUN），开启 OpenBox 后即接管流量；关闭接管时不生成入站。

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
   - **TUN 也一样**：sing-box 正常退出时会自己撤掉 TUN 的规则，但崩溃或被杀时会留下 `inet sing-box` 表和策略路由，让路由器断网。`run.sh` 在 sing-box 启动前和退出后按 sing-box 的默认优先级和路由表清理这些残留。
   - **DNS 缓存**：sing-box 退出时 dnsmasq 恢复原来的上游并重启，缓存随之清空，避免 FakeIP 残留。
   - **IPv6**：默认只接管 IPv4：DNS 解析策略为 `ipv4_only`，设备拿不到 IPv6 地址；TProxy 拒绝局域网和路由器自身发往公网的 IPv6 TCP/UDP（`bypass_address6` 中的地址除外），客户端回退到 IPv4；TUN 只有 IPv4 地址时 sing-box 不处理 IPv6。
   - **IPv6 接管**（接管页的 IPv6 开关）：同时设置 `firewall.ipv6 '1'`、`dns.strategy 'prefer_ipv4'`，并给 TUN 加 IPv6 地址（默认 `fdfe:dcba:9876::1/126`，sing-box 示例值；关闭时去掉 TUN 的 IPv6 地址、改回 `ipv4_only`）。TUN 有了 IPv6 地址，sing-box 自己接管 IPv6 路由和 DNS，规则集的 IPv6 部分（`cn-mainland-ip` 含 3534 条 IPv6）随 `route_exclude_address_set` 生效。TProxy：`firewall.uc` 不再生成拒绝 IPv6 的链，改为 `tproxy ip6` 接管，`bypass6` 集合加上规则集的 IPv6 地址（全局模式除外），并设 `ip -6` 策略路由。FakeIP 用 IPv6 地址段 `2001:2::/48`。RealIP 模式下节点需要能访问 IPv6 目标；FakeIP 模式下由节点解析域名，不受影响。
   - **接口**：启动时按 ubus 状态取局域网接口的设备，接口未就绪时用 network 配置中的 `device`；接口 up 时 hotplug 重新设置规则。
   - 两种方式下，内网地址直连，其余按路由规则和出站模式处理。
   - **全局代理模式**：国内 IP 也走代理，防火墙层不再绕过规则集（保留地址仍直连）。出站模式在策略页选择，存在 `main.mode`，和其他设置一样保存并应用后生效（不改 `clash_api.default_mode`：sing-box 把它当作一个独立的模式提供，改掉后「规则判定」会从可选模式中消失）。生成器和 `firewall.uc` 据此决定是否绕过。应用时 sing-box 不重启的，`mode.uc` 经 clash API 设置模式，TProxy 的防火墙规则有变化才重设；TUN 进出全局模式时配置改变，sing-box 重启（现有连接断开）。sing-box 把模式存在缓存文件里，启动时优先用缓存的模式，所以 `run.sh` 在每次启动后也设置一次。可选的模式按配置算：默认模式加上规则里出现的 `clash_mode`，OpenBox 没运行时也能选。
2. **DNS**：发往外部 53 端口的查询（包括设备写死的 8.8.8.8）都由 sing-box 应答（TUN 由 sing-box 劫持，TProxy 由 OpenBox 重定向到 `dns-in`），sing-box 能看到是哪台设备在查询；问路由器（dnsmasq）的查询由 dnsmasq 转给 `dns-in`（见第 3 点）。本地域名和私有网段的反查转给 dnsmasq，DHCP 主机名照常可用；其余先问国内 DNS，国内 IP 原样返回，其他按 DNS 模式处理：
   - **FakeIP**（默认）：立即返回假地址，连接时由节点解析域名。快、分流准；应答的 TTL 为 1 秒（与 mihomo 的 fake-ip 相同），设备几乎不缓存假地址，停止服务后下一次查询就拿到真实地址。假地址由 sing-box 在本地分配，查询变多几乎没有开销；自带 DNS 缓存的程序（如 Java 默认缓存 30 秒）仍要等它自己的缓存过期。
   - **RealIP**：经代理向远程 DNS 再查一次，返回真实地址。首次访问稍慢，所有应用都能正常使用，停止后不留假地址。
   - 两种模式只差 `dns_rule 'foreign'` 和 `'fallback'` 的 `server`（`fakeip` 或 `remote`）和 `rewrite_ttl`（FakeIP 为 1，RealIP 不设）；接管页的「DNS 模式」同时修改这两处。
3. **dnsmasq 转发给 sing-box**：dnsmasq 的上游常是私有地址（主路由、光猫），TUN 不接管路由器发往私有地址的查询，路由器自己和问 dnsmasq 的设备就会绕过 sing-box、拿到真实地址。所以 sing-box 运行期间，`run.sh` 在每个 dnsmasq 实例的 conf-dir（默认 `/tmp/dnsmasq.<实例>.d`）写入 `openbox.conf`：`no-resolv` 加 `server=127.0.0.1#<dns-in 端口>`，然后重启 dnsmasq；dnsmasq 仍负责 DHCP、本地域名和私有网段的反查（`local=/lan/`、`boguspriv`，OpenWrt 默认开启，sing-box 的 `local` 服务器经它解析这些名字，不会循环），其余查询交给 sing-box。sing-box 一退出（崩溃或停止）就删掉这些文件并重启 dnsmasq，恢复原来的上游；写过的文件记在 `/var/run/openbox/dnsmasq.state`，`/etc/config/dhcp` 不改动。运行的配置里没有 tag 为 `dns-in` 的 `direct` 入站（例如原生 JSON 没写）时不做转发。
4. **停止后**：sing-box 撤掉 TUN、路由规则和 nft 表，dnsmasq 回到原来的上游，国内网络立即恢复。

### 3.3.3 升级

`/etc/config/openbox` 是配置文件，升级时保留，默认值的改动不会自动出现在老用户的配置里。`main.config_version` 记录配置格式的版本；软件包附带的 uci-defaults 脚本在每次安装或升级时运行 `migrate.uc`，按版本逐级执行迁移步骤（例如补上新增的 section），最后把版本号更新到最新。新安装的配置已是最新版本，不执行任何步骤。改动默认值时，必须同时加一个迁移步骤。

### 3.4 组件

```
LuCI JS 界面（form.Map 直接读写 UCI）
   │ ubus / rpcd
   ▼
rpcd ucode 插件（luci.openbox）：状态、内核安装、可选的出站模式、组的当前节点（经 clash API）；配置文件的列表、读写、检查、切换
   │
   ▼
/etc/init.d/openbox（procd）
   ├─ generate.uc（source 为 model 时）→ /var/run/openbox/config.json
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
│       ├── openbox.conf        # /etc/config/openbox 默认值
│       ├── openbox.init
│       ├── openbox.hotplug     # 接口 up 时刷新 TProxy 规则
│       ├── openbox.uci-defaults  # 升级时运行 migrate.uc
│       ├── run.sh              # procd 运行它，它运行 sing-box 并管理 TProxy 规则
│       ├── common.sh
│       ├── core-install.sh
│       ├── rule-set/           # 国内 IP 规则集（来自 cosxs/cn-mainland-ip）
│       └── ucode/              # generate.uc、firewall.uc、migrate.uc、mode.uc
├── luci-app-openbox/
│   ├── Makefile
│   ├── htdocs/…/view/openbox/  # 各页面
│   ├── root/usr/share/rpcd/    # ACL、ucode 插件
│   └── po/
├── docs/
└── .github/workflows/
```

### 3.6 界面

| 页面 | 内容 |
| --- | --- |
| 活动 | 运行状态、配置来源、接管方式、出站模式、已运行时长（天、时、分）、内核版本、插件版本；启动 / 停止 / 重载；内核安装与更新；sing-box 自带服务在用时提示并提供「由 OpenBox 接管」 |
| 接管 | 启用、接管方式（TUN / TProxy）、DNS 模式（FakeIP / RealIP），FakeIP 时显示它的 IPv4 / IPv6 地址段；IPv6 开关（默认关闭）；TUN：接口名称、地址、MTU、绕过的规则集、绕过的 IPv4 地址、绕过的 IPv6 地址（同一个 `route_exclude_address` 按地址族拆开显示，保存时合并）；TProxy：TProxy 端口、DNS 端口、局域网接口、绕过的规则集、绕过的 IPv4 地址、绕过的 IPv6 地址；代理端口（mixed 入站）：启用、端口、用户名、密码，与接管互相独立，活动页在启用时显示端口 |
| 策略 | sing-box 的出站都在这里。出站模式（保存并应用后生效）；策略组列表：名称、类型、当前节点（下拉中显示 sing-box 测得的延迟），增删改（名称、类型、成员、包含全部节点及筛选、包含全部策略组、默认出站、自动测速参数和闲置超时、中断现有连接）；节点列表：名称、协议、服务器，增删改，按协议显示对应字段（凭据、TLS / Reality、传输方式）。当前节点经 clash API 立即生效，其余（包括出站模式）保存并应用后生效 |
| 路由规则 | 二级标签：规则、规则集。规则：结构参考 Surge，一条规则一个条件；列表为启用、类型、值、动作、注释，从上到下匹配，拖动调整顺序；新规则排在最前（固定规则之后）。弹窗：规则类型（下拉，直接是 sing-box 路由规则的字段名：domain、domain_suffix、domain_keyword、domain_regex、rule_set、ip_cidr、ip_is_private、source_ip_cidr、source_ip_is_private、source_mac_address、source_hostname、port、port_range、source_port、source_port_range、network、protocol、inbound、ip_version、auth_user）和它的值（随类型变化，下方一句说明；ip_is_private 这类布尔字段不用填值）、反向匹配（invert）；动作：route（选策略组或节点）或 reject（method：default / drop）；注释（`comment`，不生成）。手写的多条件规则显示为「多个条件」，弹窗里只改动作和注释，条件保持原样。标签底部是默认出站（`route.final`）。嗅探、DNS 劫持、内网直连和全局 / 直连模式这 5 条固定规则带 `hidden`，不显示。规则集：增删改（标签、类型：远程 / 本地文件 / 内联；格式：按扩展名 / 二进制 / 源文件；远程：URL、初始文件、下载方式、更新间隔；本地：路径；内联：规则，sing-box 无头规则的 JSON 数组），弹窗添加，不用先填 section 名；DNS 规则和接管页的绕过规则集也引用这里的规则集 |
| 设备 | 访问控制模式与设备列表 |
| 内核设置 | 二级标签依次为：日志（级别、显示设备 `find_neighbor`、时间戳）、DNS（默认服务器、解析策略、乐观缓存、节点域名解析服务器、DNS 服务器列表（不显示 FakeIP 和内置的 local；类型按官方文档写作 TCP、UDP、TLS、QUIC、HTTPS、HTTP/3）、DNS 规则（子标题下一个输入框，填 sing-box 原生 JSON 数组，保存时检查 JSON 格式））、NTP（启用、服务器、端口、同步间隔、出站）、实验性（clash API 监听地址和密钥、缓存文件；默认出站模式不在界面上提供）。只用于生成配置；配置来源为原生 JSON 时不生效 |
| 配置文件 | 一张表列出「由 OpenBox 生成」和 `/etc/openbox/profiles` 中的 JSON 文件（大小、修改时间、使用中）；生成的配置：使用、查看（只读，附生成器警告）；文件：使用、编辑、下载、删除（使用中的不能删除）。新建从当前生成的配置开始，上传时填文件名（字母、数字、`.`、`-`、`_`，以 `.json` 结尾），同名覆盖。编辑器可「检查」（`sing-box check`）、保存；使用中的文件先检查通过才保存并重载。切换前也要检查通过，运行中则立即重载。使用配置文件时，接管、策略、路由规则和内核设置页顶部提示这些设置暂不生效 |
| 日志 | 日志设置（自动清理、保留天数）；插件日志和内核日志 |

设置放在用户处理那件事时会去找的页面上；很少改、偏技术的 sing-box 全局设置放进「内核设置」。

所有页面顶部依次是「OpenBox」和一句简介、OpenBox 的标签栏，和系统页一样标题在上、标签在下。菜单里各子页面不设标题，主题就不画它们的标签；标签栏由各页用 LuCI 原生的 `cbi-tabmenu` 画在标题下面（`openbox/ui.js`），窗口标题由它补上页面名。「服务 → OpenBox」直接打开活动页。不为某个主题单独适配；原来各页的说明放进各自第一个分组。

有单位的输入框在框后显示固定单位，只填整数：测速间隔、闲置超时、NTP 同步间隔（分钟），规则集更新间隔（小时），容差（毫秒），日志保留（天）。时长按单位换成 sing-box 的写法保存（填 3 存 `3m`）；UCI 里已有的其他写法（如 `90s`）原样显示和保留。

目前菜单只放已有内容的页面：活动、接管、策略、路由规则、内核设置、配置文件、日志；设备页（访问控制）做好后再加入。服务的启用也在活动页完成（「启用」按钮）。

## 4. 环境要求

- OpenWrt 25.12（fw4，apk）
- 依赖：`kmod-tun`、`kmod-nft-queue`（`auto_redirect` 的预匹配用到 nfqueue）、`kmod-nft-tproxy`（TProxy）、`kmod-inet-diag`、`ca-bundle`、`ip-full`、`ucode-mod-socket`（经 clash API 设置出站模式，界面也用）
- sing-box ≥ 1.14：不随软件包安装，也不使用 OpenWrt 软件源的版本。系统里已有符合版本的 `/usr/bin/sing-box`（官方包或固件自带）时直接使用，不需要另装；否则由用户在 OpenBox 页面中从 GitHub 安装最新版，或上传官方发布页的 `sing-box_*_openwrt_<架构>.apk`。官方构建安装后约占 90 MB 存储。
- sing-box 包自带的服务（`/etc/init.d/sing-box`）：OpenBox 自己运行 sing-box。自带服务只是装着、不运行时（未运行，且没有同时开启开机自启和 `sing-box.main.enabled`），OpenBox 直接使用；自带服务正在运行或会开机运行时，OpenBox 不启动，活动页提示冲突并提供「由 OpenBox 接管」，点击后才停止并禁用自带服务、启用并启动 OpenBox。从 OpenBox 安装内核属于手动操作，新装包的自带服务会直接禁用。卸载 OpenBox 后不会自动恢复。

## 5. 项目信息

- 名称：`openbox`
- License：GPL-3.0
