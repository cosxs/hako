# Hako

在 OpenWrt 上运行 sing-box 的简约客户端。

> 开发中，尚未可用。规划见 [docs/product-plan.md](docs/product-plan.md)。

## 环境要求

- OpenWrt 25.12
- sing-box ≥ 1.14：安装后在 LuCI 的 Hako 页面中安装，可从 GitHub 安装最新版，或上传官方发布页的 apk

## 安装

```shell
wget -O - https://github.com/cosxs/hako/raw/main/install.sh | sh
```

## 卸载

会同时删除配置、配置文件和日志。

```shell
wget -O - https://github.com/cosxs/hako/raw/main/uninstall.sh | sh
```

## 编译

```shell
echo "src-git hako https://github.com/cosxs/hako.git;main" >> feeds.conf.default
./scripts/feeds update -a
./scripts/feeds install -a
make package/luci-app-hako/compile
```

## 测试

`tests/run.sh` 用 `tests/cases` 下的 UCI 配置运行 `generate.uc` 和 `migrate.uc`，与各用例的预期结果比对，并用 `sing-box check` 检查生成的配置。在装有 Hako 依赖的设备上，或装有 ucode（含 uci 模块）和 sing-box 的 Linux 上，于仓库根目录运行 `tests/run.sh` 即可；命令路径可用 `UCODE`、`SING_BOX` 环境变量指定。修改生成逻辑后，用 `tests/run.sh --update` 重新生成预期结果，再核对差异。

## License

[GPL-3.0](LICENSE)
