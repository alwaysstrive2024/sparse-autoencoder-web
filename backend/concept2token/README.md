# concept2token 文件夹说明

此目录存放各模型的「Feature → Concept Label」本地映射文件。

## 文件格式

每个 JSON 文件对应一个（或多个共用同一 hf 基座的）模型。

```json
{
  "blocks.4.hook_resid_pre": {
    "3045": {
      "top_bound_token": " de",
      "enrichment_score": 15.42,
      "avg_activation": 2.85,
      "firing_count": 42
    },
    "8192": {
      "top_bound_token": " the",
      "enrichment_score": 1.02,
      "avg_activation": 0.54,
      "firing_count": 1250
    }
  }
}
```

## 字段说明

| 层级 | Key | 说明 |
|---|---|---|
| 外层 | hook_point 字符串 | 与 registry.py 中 hook_point 字段对应 |
| 内层 | feature_id（字符串化数字） | SAE 特征 ID |
| Value.top_bound_token | 字符串 | 该特征绑定度最高的 token（作为 concept label 展示） |
| Value.enrichment_score | 数值 | 特异性得分（保留，供后续分析用） |
| Value.avg_activation | 数值 | 平均激活值（保留） |
| Value.firing_count | 整数 | 激活次数（保留） |

## 注意事项

- 文件名对应 registry.py 中每个模型的 "concept-json" 字段值（不含 .json 后缀）
- 同一 hf 模型不同 hook 层的 registry 条目可以共用同一个 JSON 文件
- JSON 文件里没有的 feature_id → fallback 为 "Concept {id}"
- 配置了 concept-json 的模型：完全跳过 Neuronpedia API 调用
