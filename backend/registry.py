"""
registry.py — Model Registry
=============================
★ THIS IS THE ONLY FILE YOU NEED TO EDIT TO ADD A NEW MODEL ★

Each entry requires exactly three fields:
  display_name  — human-readable name shown in the UI
  sae_release   — SAELens release string (HuggingFace repo or named release)
  sae_id        — SAELens SAE identifier within that release

All other metadata (d_model, hook_point, layer, hf_model_name) is extracted
automatically from sae.cfg at runtime and cached — no hardcoding required.

──────────────────────────────────────────────────────────────────────────────
How to find sae_release / sae_id for a new model:
  • Named SAELens releases: https://jbloomaus.github.io/SAELens/api/#saelens.pretrained_saes
  • HuggingFace repos:      from sae_lens import SAE
                            sae, _, _ = SAE.from_pretrained("<release>", "<sae_id>")
                            print(sae.cfg.hook_name, sae.cfg.d_in, sae.cfg.model_name)
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations
from typing import Dict

ModelEntry = Dict[str, object]

# Registry
# ─────────────────────────────────────────────────────────────────────────────

MODEL_REGISTRY: Dict[str, ModelEntry] = {

     # ── GPT-2 Small ───────────────────────────────────────────────────────────
    "gpt2-small-l4": {
        "display_name":  "GPT-2(Layer 4)",
        "sae_release":   "gpt2-small-res-jb",
        "sae_id":        "blocks.4.hook_resid_pre",
        "hf_model_name": "gpt2",
        "hook_point":    "blocks.4.hook_resid_pre",
        "hook_layer":    4,
        "chinese_input_policy": "translate_to_en",
    },
    "gpt2-small-l8": {
        "display_name":  "GPT-2(Layer 8)",
        "sae_release":   "gpt2-small-res-jb",
        "sae_id":        "blocks.8.hook_resid_pre",
        "hf_model_name": "gpt2",
        "hook_point":    "blocks.8.hook_resid_pre",
        "hook_layer":    8,
        "chinese_input_policy": "translate_to_en",
    },
    "gpt2-small-l11": {
        "display_name":  "GPT-2(Layer 11)",
        "sae_release":   "gpt2-small-res-jb",
        "sae_id":        "blocks.11.hook_resid_pre",
        "hf_model_name": "gpt2",
        "hook_point":    "blocks.11.hook_resid_pre",
        "hook_layer":    11,
        "chinese_input_policy": "translate_to_en",
    }, 

    # —— Google Gemma 3  ──────────────────────────────
    "gemma-3-l4": {
        "display_name":  "Gemma 3 (Layer 4)",
        "sae_release":   "chanind/gemma-3-1b-batch-topk-matryoshka-saes-w-32k-l0-40",
        "sae_id":        "blocks.4.hook_resid_post",
        "hf_model_name": "google/gemma-3-1b-pt",
        "hook_point":    "blocks.4.hook_resid_post",
        "hook_layer":    4,
        "np_model_id":   "gemma-3-1b-pt",
        "np_sae_id":     "4-res-jb",
        "chinese_input_policy": "translate_to_en",
    }, 
    "gemma-3-l8": {
        "display_name":  "Gemma 3 (Layer 8)",
        "sae_release":   "chanind/gemma-3-1b-batch-topk-matryoshka-saes-w-32k-l0-40",
        "sae_id":        "blocks.8.hook_resid_post",
        "hf_model_name": "google/gemma-3-1b-pt",
        "hook_point":    "blocks.8.hook_resid_post",
        "hook_layer":    8,
        "np_model_id":   "gemma-3-1b-pt",
        "np_sae_id":     "8-res-jb",
        "chinese_input_policy": "translate_to_en",
    }, 
    "gemma-3-l12": {
        "display_name":  "Gemma 3 (Layer 12)",
        "sae_release":   "chanind/gemma-3-1b-batch-topk-matryoshka-saes-w-32k-l0-40",
        "sae_id":        "blocks.12.hook_resid_post",
        "hf_model_name": "google/gemma-3-1b-pt",
        "hook_point":    "blocks.12.hook_resid_post",
        "hook_layer":    12,
        "np_model_id":   "gemma-3-1b-pt",
        "np_sae_id":     "12-res-jb",
        "chinese_input_policy": "translate_to_en",
    },  

    # ── Google Gemma-4 E2B (decoderesearch SAEs) ──────────────────────────────
    # 基座模型: google/gemma-4-E2B（Gemma 4 第二代，2B 参数）
    "gemma-4-e2b-l6": {
        "display_name":  "Gemma-4 (Layer 6)",
        "sae_release":   "decoderesearch/gemma-4-saes",
        "sae_id":        "gemma-4-e2b/btk-mat-layer-6-k-100",
        "hf_model_name": "google/gemma-4-E2B-it",
        "hook_point":    "blocks.6.hook_resid_post",
        "hook_layer":    6,
        "chinese_input_policy": "translate_to_en",
    },
    "gemma-4-e2b-l17": {
        "display_name":  "Gemma-4 (Layer 17)",
        "sae_release":   "decoderesearch/gemma-4-saes",
        "sae_id":        "gemma-4-e2b/btk-mat-layer-17-k-100",
        "hf_model_name": "google/gemma-4-E2B-it",
        "hook_point":    "blocks.17.hook_resid_post",
        "hook_layer":    17,
        "chinese_input_policy": "translate_to_en",
    },
    "gemma-4-e2b-l28": {
        "display_name":  "Gemma-4 (Layer 28)",
        "sae_release":   "decoderesearch/gemma-4-saes",
        "sae_id":        "gemma-4-e2b/btk-mat-layer-28-k-100",
        "hf_model_name": "google/gemma-4-E2B-it",
        "hook_point":    "blocks.28.hook_resid_post",
        "hook_layer":    28,
        "chinese_input_policy": "translate_to_en",
    },

    # ── Meta Llama 3.2 1B ─────────────────────────────────────────────────────
    "llama-3.2-1b-l4": {
        "display_name":  "Llama 3.2 (Layer 4)",
        "sae_release":   "chanind/sae-llama-3.2-1b-topk-res",
        "sae_id":        "blocks.4.hook_resid_post/l0-10",
        "hf_model_name": "meta-llama/Llama-3.2-1B",
        "hook_point":    "blocks.4.hook_resid_post",
        "hook_layer":    4,
        "chinese_input_policy": "translate_to_en",
    },
    "llama-3.2-1b-l8": {
        "display_name":  "Llama 3.2 (Layer 8)",
        "sae_release":   "chanind/sae-llama-3.2-1b-topk-res",
        "sae_id":        "blocks.8.hook_resid_post/l0-10",
        "hf_model_name": "meta-llama/Llama-3.2-1B",
        "hook_point":    "blocks.8.hook_resid_post",
        "hook_layer":    8,
        "chinese_input_policy": "translate_to_en",
    }, 
    "llama-3.2-1b-l12": {
        "display_name":  "Llama 3.2 (Layer 12)",
        "sae_release":   "chanind/sae-llama-3.2-1b-topk-res",
        "sae_id":        "blocks.12.hook_resid_post/l0-10",
        "hf_model_name": "meta-llama/Llama-3.2-1B",
        "hook_point":    "blocks.12.hook_resid_post",
        "hook_layer":    12,
        "chinese_input_policy": "translate_to_en",
    },

   # ── Qwen 3.5 0.8B (decoderesearch SAEs) ──────────────────────────────────
    "qwen-3.5-0.8b-l5": {
        "display_name":  "Qwen 3.5 (Layer 5)",
        "sae_release":   "decoderesearch/qwen-3.5-saes",
        "sae_id":        "qwen-3.5-0.8b/btk-mat-layer-5-k-100",
        "hf_model_name": "Qwen/Qwen3.5-0.8B",
        "hook_point":    "blocks.5.hook_resid_post",
        "hook_layer":    5,
        "chinese_input_policy": "translate_to_en",
    }, 
    "qwen-3.5-0.8b-l11": {
        "display_name":  "Qwen 3.5 (Layer 11)",
        "sae_release":   "decoderesearch/qwen-3.5-saes",
        "sae_id":        "qwen-3.5-0.8b/btk-mat-layer-11-k-100",
        "hf_model_name": "Qwen/Qwen3.5-0.8B",
        "hook_point":    "blocks.11.hook_resid_post",
        "hook_layer":    11,
        "chinese_input_policy": "translate_to_en",
    },
    "qwen-3.5-0.8b-l17": {
        "display_name":  "Qwen 3.5 (Layer 17)",
        "sae_release":   "decoderesearch/qwen-3.5-saes",
        "sae_id":        "qwen-3.5-0.8b/btk-mat-layer-17-k-100",
        "hf_model_name": "Qwen/Qwen3.5-0.8B",
        "hook_point":    "blocks.17.hook_resid_post",
        "hook_layer":    17,
        "chinese_input_policy": "translate_to_en",
    },  

    # ── DeepSeek R1 ───────────────────────────────────────────────────────────
    "deepseek-r1-l16": {
        "display_name":  "DeepSeek R1",
        "sae_release":   "Farmerobot/deepseek-r1-1.5b-sae-l16-topk32-v2",
        "sae_id":        "deepseek_base_l16_topk32_0M",
        "hf_model_name": "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
        # 发布方元数据明确声明此 SAE 训练于第 16 层输入，而不是层输出。
        "hook_point":    "blocks.16.hook_resid_pre",
        "hook_layer":    16,
        "chinese_input_policy": "translate_to_en",
    },
    

    # ── Add new models below ──────────────────────────────────────────────────
    # Template:
    # "your-model-key": {
    #     "display_name":  "Your Model Name",
    #     "sae_release":   "hf-org/repo-name",
    #     "sae_id":        "path/to/sae-id",
    #     "hf_model_name": "org/model-name",       # 真实 HF 基座模型 ID
    #     "hook_point":    "blocks.N.hook_resid_post",
    #     "hook_layer":    N,
    #     "chinese_input_policy": "translate_to_en",
    # },

}
