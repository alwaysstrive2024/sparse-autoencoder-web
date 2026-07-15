# syntax=docker/dockerfile:1.7

# 使用完整、稳定的 Ubuntu 22.04 作为 Sidecar 运行环境。虽然已验证的 Clash
# 二进制是静态链接文件，本身不依赖 glibc，但 Ubuntu 能为现场排障保留更完整
# 的 shell、网络、DNS、进程和证书工具；Pod 磁盘充足时可靠性优先于极限体积。
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# 常用排障能力：
#   bash                 交互式排查和脚本
#   curl/wget            验证 HTTP(S)、订阅与外网
#   iproute2/iputils-ping 检查地址、路由、端口和连通性
#   dnsutils             dig/nslookup 排查 DNS
#   netcat-openbsd       nc 检查 localhost:7890 和远端 TCP
#   procps               ps/top 等进程工具
#   jq                   查看 API/JSON 响应
#   ca-certificates      HTTPS 证书链
#   tini                 作为 PID 1 正确转发信号并回收子进程
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iputils-ping \
        jq \
        netcat-openbsd \
        procps \
        tini \
        tzdata \
        wget \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8

# 在 COPY 阶段固定执行权限，运行时无需 kubectl exec 后再 chmod。
COPY --chmod=0755 clash /usr/local/bin/clash

# Country.mmdb 是非敏感 GeoIP 静态资产。真实 config.yaml 被 .dockerignore 排除，
# 只会在 Helm 安装时由 ConfigMap 挂载。
COPY Country.mmdb /opt/clash/Country.mmdb

WORKDIR /root

EXPOSE 7890 9090

# tini 负责 PID 1 信号处理，Clash 保持前台运行，日志直接进入 kubectl logs。
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/clash"]
CMD ["-d", "/root/.config/clash", "-f", "/etc/clash/config.yaml"]
