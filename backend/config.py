from __future__ import annotations
"""
config.py — Global constants and shared utility functions
=========================================================
Import this module in pipeline.py and main.py.
"""

# ── 镜像源设置（必须在所有 HuggingFace 库导入之前）────────────────────────────
# import os

import gc
import os
import re
from typing import Any, List, Optional

# Hugging Face/TransformerLens 共用的模型缓存根目录。容器运行时把宿主机
# 缓存卷挂载到 MODEL_PATH，即可复用大模型权重，而不需要把权重 COPY 进镜像。
DEFAULT_MODEL_PATH = "/root/.cache/huggingface"
MODEL_PATH = os.getenv("MODEL_PATH", DEFAULT_MODEL_PATH).strip() or DEFAULT_MODEL_PATH
MODEL_CACHE_DIR = os.path.join(MODEL_PATH, "hub")

# 必须在 transformers、huggingface_hub、sae_lens 等库首次导入前设置。
# SAE Lens 的内部下载没有统一暴露 cache_dir 参数，因此让它遵循 HF_HOME。
os.environ["HF_HOME"] = MODEL_PATH
os.environ["HF_HUB_CACHE"] = MODEL_CACHE_DIR

# Dependency flags (set by main.py after import-time detection)
TORCH_AVAILABLE: bool = False

def set_torch_available(flag: bool) -> None:
    global TORCH_AVAILABLE
    TORCH_AVAILABLE = flag


# Concept label bank
CONCEPT_LABELS: List[str] = [
    "Corporate Entities", "Tech Release", "Product Announcement",
    "Financial News", "Named Persons", "Geopolitical", "Temporal Markers",
    "Numeric Values", "Action Verbs", "Attributive Adjectives",
    "Consumer Electronics", "Brand Names", "Software Ecosystem",
    "Market Dynamics", "Innovation & R&D", "Media & Press",
    "Legal & Regulatory", "Supply Chain", "Sentiment — Positive",
    "Sentiment — Negative", "Scientific Concepts", "Historical References",
    "Sports & Recreation", "Cultural References", "Medical & Health",
    "Environmental Topics", "Political Discourse", "Economic Indicators",
    "Abstract Reasoning", "Logical Connectives",
]

# Utility functions
# ─────────────────────────────────────────────────────────────────────────────

def concept_label(feature_id: int, rng: Any) -> str:
    """Map a feature ID to a concept label (deterministic round-robin)."""
    return CONCEPT_LABELS[feature_id % len(CONCEPT_LABELS)]


def vram_clear() -> None:
    """Free Python GC cycles and flush CUDA memory caches."""
    import gc as _gc
    _gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            used_mb = torch.cuda.memory_allocated() / 1024 ** 2
            print(f"[VRAM] 🧹 Cleared — allocated: {used_mb:.1f} MB")
            return
        
    except ImportError:
        pass
    print("[VRAM] 🧹 CPU mode — gc.collect() called")


def naive_tokenise(text: str) -> List[str]:
    """Minimal whitespace/punctuation tokeniser used in mock mode."""
    tokens = re.findall(r"\w+(?:'\w+)*|[^\w\s]", text)
    return tokens if tokens else [text]


def safe_sae_attr(cfg: Any, *names: str, default: Any = None) -> Any:
    """
    Read the first available attribute from an sae.cfg object.
    Handles API differences across SAELens versions:
      hook_name  vs  hook_point
      d_in       vs  d_model
      hook_layer vs  layer
    """
    for name in names:
        val = getattr(cfg, name, None)
        if val is not None:
            return val
    return default


def layer_from_hook(hook_name: str) -> Optional[int]:
    """
    Extract the layer index from a TransformerLens hook name.
    e.g. 'blocks.12.hook_resid_post' → 12
    """
    m = re.search(r'\.(\d+)\.', hook_name or "")
    return int(m.group(1)) if m else None
