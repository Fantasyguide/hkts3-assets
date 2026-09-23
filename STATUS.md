# 实施状态

2026-09-23 09:58（UTC+8）：首次资源发布成功，项目区域已通过云 API 确认为 `mainland`。私有 GitHub 仓库、20 张哈希图片、手动发布流程和回滚说明均已建立；6 项资源脚本测试、5 项平台图片与导出回归通过，GitHub runner 也通过相同资源测试。

| 项目 | 值 |
| --- | --- |
| GitHub 仓库 | https://github.com/Fantasyguide/hkts3-assets |
| EdgeOne 项目 | `hkts3-assets` / `makers-z5cnrorgii3z` |
| 中国站 / 加速区 | `china` / `mainland` |
| 首次部署 | `dp00zv3t146h`，`Success` |
| 资源提交 | `1dede41f6d92e8567c33faa4a42459cd22309654` |
| 手动工作流 | [35808407231](https://github.com/Fantasyguide/hkts3-assets/actions/runs/35808407231) |
| 图片正文 | 20 张，325,708 字节 |
| 上传 ZIP | 330,903 字节，23 个文件；清单和脚本不在包内 |
| 正式域名 | `hkts3-assets.fantasyguide.cn`，待绑定、DNS 与 HTTPS 完成 |

完整记录见 [首次部署记录](deployments/20260923-initial.json)。本 WSL 已保存从 Actions 下载的实际上传 ZIP：`dist/cloud-35808407231/public.zip`，已校验归档 SHA-256 和所有文件内容。其他电脑可从上述 Actions 下载同一制品，保留期 30 天。不同 Git 版本重打包得到的 ZIP 哈希可能不同，恢复原制品时使用记录对应的下载包。

GitHub Secrets 保存凭据，文件与制品不保存 Token。登录无需回调到 WSL；此前本机 CLI 登录监听已停止。

待完成：控制台绑定正式域名并申请免费证书；管理员按控制台实际要求设置归属验证与 CNAME；域名生效后校验 20 张图片、缓存和 404。尚未进行真实 CDN 图片访问验收或大陆三网速度抽查，不把云端部署成功当作这些验收已完成。

谜题生产服务器未修改、未重新压测；生产 `imageBaseUrl` 尚未启用。
