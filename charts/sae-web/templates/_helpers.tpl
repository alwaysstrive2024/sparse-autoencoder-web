{{/* Chart 的短名称。 */}}
{{- define "sae-web.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Release 级名称；所有 Deployment 标签以它为基础，避免不同 Release 串流。 */}}
{{- define "sae-web.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Helm 推荐的 Chart 标签值。 */}}
{{- define "sae-web.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* 所有资源共享的可观测标签。 */}}
{{- define "sae-web.labels" -}}
helm.sh/chart: {{ include "sae-web.chart" . }}
app.kubernetes.io/name: {{ include "sae-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/* 前端 Deployment/Pod/Service 必须共用这组稳定 selector。 */}}
{{- define "sae-web.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sae-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: frontend
{{- end }}

{{/* 后续 backend Deployment 和当前 backend Service 共用这组 selector。 */}}
{{- define "sae-web.backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sae-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: backend
{{- end }}

{{- define "sae-web.frontend.fullname" -}}
{{- printf "%s-frontend" (include "sae-web.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sae-web.backend.fullname" -}}
{{- printf "%s-backend" (include "sae-web.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
前端 Nginx 当前固定代理到 sae-backend-svc:8000，因此 backend Service 默认
必须保持这个名字。未来将 Nginx 改为启动时 envsubst 后即可使用 Release 名称。
*/}}
{{- define "sae-web.backend.serviceName" -}}
{{- default (include "sae-web.backend.fullname" .) .Values.backend.service.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sae-web.frontend.serviceName" -}}
{{- default (include "sae-web.frontend.fullname" .) .Values.frontend.service.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* 新 Helm Ingress 名称与旧手工资源 sae-frontend-ingress 明确区分。 */}}
{{- define "sae-web.ingress.fullname" -}}
{{- default (printf "%s-ingress" (include "sae-web.fullname" .)) .Values.ingress.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Clash ConfigMap 名称；允许引用集群中预先存在的 ConfigMap。 */}}
{{- define "sae-web.clash.configMapName" -}}
{{- if .Values.clash.config.existingConfigMap }}
{{- .Values.clash.config.existingConfigMap | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- default (printf "%s-clash" (include "sae-web.fullname" .)) .Values.clash.config.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
