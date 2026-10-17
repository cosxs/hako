# OpenBox

在 OpenWrt 上运行 sing-box 的简约客户端。

> 开发中，尚未可用。规划见 [docs/product-plan.md](docs/product-plan.md)。

## 环境要求

- OpenWrt 25.12
- sing-box ≥ 1.14：安装后在 LuCI 的 OpenBox 页面中安装，可从 GitHub 安装最新版，或上传官方发布页的 apk

## 安装

```shell
wget -O - https://github.com/cosxs/openbox/raw/main/install.sh | sh
```

## 卸载

会同时删除配置、配置文件和日志。

```shell
wget -O - https://github.com/cosxs/openbox/raw/main/uninstall.sh | sh
```

## 编译

```shell
echo "src-git openbox https://github.com/cosxs/openbox.git;main" >> feeds.conf.default
./scripts/feeds update -a
./scripts/feeds install -a
make package/luci-app-openbox/compile
```

## License

[GPL-3.0](LICENSE)
