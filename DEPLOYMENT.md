# SAE Web 部署文档入口

当前生产部署已经统一为 Helm，公网入口使用独立 Sakura frpc Deployment。

新读者或需要从源码完整复刻者，请先阅读：

```text
SAE_WEB_DEPLOYMENT_WHITEPAPER.md
```

其他文档按用途选择：

| 文档 | 用途 |
|---|---|
| `SAE_WEB_DEPLOYMENT_WHITEPAPER.md` | 完整架构、源码、构建、部署、故障复盘和运维 |
| `charts/sae-web/DEPLOYMENT.md` | 日常 Helm 构建与安装命令 |
| `ingress_frp_plan.md` | Sakura Frp、Ingress、TLS 与正式域名专项 |
| `deploy_fix.md` | Blackwell CUDA 正式修复历史 |

根目录的 `sae-demo-deploy.yaml` 已弃用，仅供历史参考。禁止执行
`kubectl apply -f sae-demo-deploy.yaml`，否则会与 Helm Release 使用不同的 Secret、
存储和 Clash 配置，造成配置漂移。
