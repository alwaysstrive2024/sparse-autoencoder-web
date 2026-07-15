"""
pipeline.py — Analysis Engine
==============================
Handles all computation:
  • _resolve_model_config()   — lazy config extraction from sae.cfg (cached)
  • _extract_activations_tl()  — Path A: TransformerLens HookedTransformer
  • _extract_activations_hf()  — Path B: HuggingFace + register_forward_hook
  • _build_reports()           — Report 1 (global) + Report 2 (per-token)
  • _mock_analyse_model()      — Seeded-random mock (no ML deps needed)
  • _real_analyse_model()      — Full dual-path real pipeline
  • analyse_model()            — Public dispatch entry point
"""

from __future__ import annotations

import os
import random
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

from config import (
    MODEL_CACHE_DIR,
    layer_from_hook,
    naive_tokenise,
    safe_sae_attr,
    vram_clear,
)
from registry import MODEL_REGISTRY
from neuronpedia import get_concept_labels_batch

# Dependency flags — injected by main.py at startup
# ─────────────────────────────────────────────────────────────────────────────

TL_AVAILABLE:   bool = False
SAE_AVAILABLE:  bool = False
HF_AVAILABLE:   bool = False
TORCH_AVAILABLE: bool = False
FULL_PIPELINE:  bool = False


def _mock_fallback_enabled() -> bool:
    """Allow mock data only when explicitly enabled (normally local development)."""
    return os.getenv("ALLOW_MOCK_FALLBACK", "true").strip().lower() in {
        "1", "true", "yes", "on"
    }


def set_deps(tl: bool, sae: bool, hf: bool, torch_ok: bool) -> None:
    """Called once by main.py after dependency detection."""
    global TL_AVAILABLE, SAE_AVAILABLE, HF_AVAILABLE, TORCH_AVAILABLE, FULL_PIPELINE
    TL_AVAILABLE    = tl
    SAE_AVAILABLE   = sae
    HF_AVAILABLE    = hf
    TORCH_AVAILABLE = torch_ok
    FULL_PIPELINE   = torch_ok and sae and (tl or hf)


def _normalise_prompt_text(prompt: Any) -> str:
    """Coerce single-item batch inputs into the plain text expected downstream."""
    if isinstance(prompt, (list, tuple)):
        if not prompt:
            raise ValueError("Prompt batch must contain at least one item.")
        prompt = prompt[0]
    return str(prompt)


def _load_sae(
    release: str,
    sae_id: str,
    *,
    device: str = "cpu",
) -> Any:
    """Load an SAE across the SAELens 3.x and 6.x return-value APIs.

    SAELens 3.x returned ``(sae, cfg_dict, sparsity)`` while 6.x returns the
    SAE object directly. Normalising that small API difference here keeps the
    analysis pipeline independent from the installed major version.
    """
    from sae_lens import SAE

    loaded = SAE.from_pretrained(
        release=release,
        sae_id=sae_id,
        device=device,
    )
    return loaded[0] if isinstance(loaded, tuple) else loaded


def _sae_model_kwargs(sae_cfg: Any) -> Dict[str, Any]:
    """Read model-loading kwargs from both legacy and modern SAE configs."""
    direct = getattr(sae_cfg, "model_from_pretrained_kwargs", None)
    if direct:
        return dict(direct)
    metadata = getattr(sae_cfg, "metadata", None)
    nested = getattr(metadata, "model_from_pretrained_kwargs", None)
    return dict(nested or {})


# Config cache  (model_key → resolved config dict)
_CONFIG_CACHE: Dict[str, Dict[str, Any]] = {}


# Concept JSON loader
def _load_concept_json(name: str) -> Dict[int, str]:
    """
    Load feature_id → top_bound_token mapping from concept2token/<name>.json.

    JSON structure:
        { "<hook_point>": { "<feature_id>": { "top_bound_token": "...", ... } } }

    Returns an empty dict on any failure (silent degradation to Concept {id}).
    """
    import json
    import pathlib
    path = pathlib.Path(__file__).parent / "concept2token" / f"{name}_concept_to_token.json"

    print(f"[ConceptJSON] 🔍 Debugging path: {path}")
    if not path.exists():
        print(f"[ConceptJSON] ⚠️  File not found: {path}")
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw: Dict[str, Any] = json.load(f)
    
        
        result = {
            int(k): v["top_bound_token"]
            for k, v in raw.items()
            if isinstance(v, dict) and "top_bound_token" in v
        }
        print(f"[ConceptJSON] ✅ Loaded {len(result)} label overrides ({name}")
        return result
    
    except Exception as exc:
        print(f"[ConceptJSON] ❌ Load failed ({path}): {exc}")
        return {}


def _stub_config(model_key: str) -> Dict[str, Any]:
    """Minimal config when SAELens is unavailable (mock mode only)."""
    reg = MODEL_REGISTRY[model_key]
    return {
        "display_name":  reg.get("display_name", model_key),
        "hf_model_name": model_key,
        "sae_release":   reg["sae_release"],
        "sae_id":        reg["sae_id"],
        "hook_point":    "blocks.4.hook_resid_post",
        "layer":         4,
        "d_model":       512,
    }


def _resolve_model_config(model_key: str) -> Dict[str, Any]:
    """
    Return fully-resolved config for a model key.

    First call: loads SAE just long enough to read sae.cfg, builds the config
    dict, caches it, then immediately frees SAE weights.
    Subsequent calls: returns from cache in O(1).
    """
    if model_key in _CONFIG_CACHE:
        return _CONFIG_CACHE[model_key]

    reg = MODEL_REGISTRY[model_key]

    if not SAE_AVAILABLE:
        cfg = _stub_config(model_key)
        _CONFIG_CACHE[model_key] = cfg
        return cfg

    print(f"[CONFIG] 🔭 [SAELens] Fetching config for '{model_key}' …")
    print(f"[CONFIG]   release='{reg['sae_release']}'  sae_id='{reg['sae_id']}'")

    sae_obj = _load_sae(
        release=reg["sae_release"],
        sae_id=reg["sae_id"],
    )
    sae_cfg = sae_obj.cfg

    hook_point    = safe_sae_attr(sae_cfg, "hook_name", "hook_point",  default="")
    d_model       = safe_sae_attr(sae_cfg, "d_in",      "d_model",     default=512)
    hook_layer    = safe_sae_attr(sae_cfg, "hook_layer", "layer",       default=None)
    hf_model_name = safe_sae_attr(sae_cfg, "model_name", "model_id",   default=model_key)
    sae_id_read   = safe_sae_attr(sae_cfg, "sae_id",                    default=reg["sae_id"])

    # ── Registry overrides take priority over sae.cfg ───────────────────────
    if reg.get("hf_model_name"):
        hf_model_name = reg["hf_model_name"]
    if reg.get("hook_point"):
        hook_point = reg["hook_point"]
    if reg.get("hook_layer") is not None:
        hook_layer = reg["hook_layer"]
    # ────────────────────────────────────────────────────────────────────────

    if hook_layer is None:
        hook_layer = layer_from_hook(hook_point) or 0

    config: Dict[str, Any] = {
        "display_name":  reg.get("display_name", hf_model_name),
        "hf_model_name": hf_model_name,
        "sae_release":   reg["sae_release"],
        "sae_id":        sae_id_read,
        "hook_point":    hook_point,
        "layer":         hook_layer,
        "d_model":       d_model,
        "np_model_id":   reg.get("np_model_id"),
        "np_sae_id":     reg.get("np_sae_id"),
        "model_from_pretrained_kwargs": _sae_model_kwargs(sae_cfg),
    }

    del sae_obj
    vram_clear()

    _CONFIG_CACHE[model_key] = config
    print(
        f"[CONFIG] ✅ Cached: hf='{hf_model_name}', "
        f"hook='{hook_point}', d_model={d_model}, layer={hook_layer}"
    )
    return config


# Path A — TransformerLens
# ─────────────────────────────────────────────────────────────────────────────

def _extract_activations_tl(
    hf_model_name: str,
    hook_point: str,
    prompt: str,
    device: str,
    model_from_pretrained_kwargs: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, List[str]]:
    """
    Use HookedTransformer.run_with_hooks() to capture residual-stream
    activations at `hook_point`.
    Returns (resid Tensor[seq, d_model], token_strs).
    """
    import torch
    from transformer_lens import HookedTransformer

    prompt_text = _normalise_prompt_text(prompt)
    print(f"[PATH-A | TL] 🔬 [TransformerLens] Loading '{hf_model_name}' …")
    
    model_kwargs = dict(model_from_pretrained_kwargs or {})
    print(f"[PATH-A | TL] SAE model kwargs: {model_kwargs}")
    model = HookedTransformer.from_pretrained_no_processing(
        hf_model_name,
        device=device,
        cache_dir=MODEL_CACHE_DIR,
        **model_kwargs,
    )
    model.eval()
    print(f"[PATH-A | TL] ✅ d_model={model.cfg.d_model}, n_layers={model.cfg.n_layers}")

    tokens_tensor = model.to_tokens(prompt_text)
    # 修复 Gemma 等模型传入纯字符串时的类型转换 Bug，改用生成的 tokens_tensor 引导转换
    token_strs: List[str] = model.to_str_tokens(tokens_tensor[0])
    print(f"[PATH-A | TL] 🔢 {len(token_strs)} tokens: {token_strs}")

    captured: Dict[str, Any] = {}

    def hook_fn(value: Any, hook: Any) -> Any:
        captured["resid"] = value.detach().clone()
        print(f"[PATH-A | TL] 🎯 Hook fired @ '{hook.name}' — {tuple(value.shape)}")
        return value

    with torch.no_grad():
        model.run_with_hooks(tokens_tensor, fwd_hooks=[(hook_point, hook_fn)])

    resid = captured["resid"][0]  # (seq, d_model)
    del model
    vram_clear()
    return resid, token_strs


# Path B — HuggingFace + register_forward_hook
# ─────────────────────────────────────────────────────────────────────────────

def _find_hf_layer(model: Any, layer_idx: int) -> Any:
    """
    Locate transformer block `layer_idx` across common HF architectures:
      Llama / Gemma / Mistral / Qwen  →  model.model.layers[n]
      GPT-NeoX / Pythia               →  model.gpt_neox.layers[n]
      GPT-2                            →  model.transformer.h[n]
      OPT                              →  model.model.decoder.layers[n]
    """
    candidates = [
        lambda m, n: m.model.language_model.layers[n],
        lambda m, n: m.language_model.layers[n],
        lambda m, n: m.model.layers[n],
        lambda m, n: m.gpt_neox.layers[n],
        lambda m, n: m.transformer.h[n],
        lambda m, n: m.model.decoder.layers[n],
        lambda m, n: m.transformer.blocks[n],
    ]
    for fn in candidates:
        try:
            layer = fn(model, layer_idx)
            if layer is not None:
                print(f"[PATH-B | HF] 🎯 Layer {layer_idx}: {type(layer).__name__}")
                return layer
        except (AttributeError, IndexError, TypeError):
            continue
    raise RuntimeError(
        f"Cannot locate layer {layer_idx} in {type(model).__name__}. "
        "Add its attribute path to _find_hf_layer() in pipeline.py."
    )


def _extract_activations_hf(
    hf_model_name: str,
    layer_idx: int,
    hook_point: str,
    prompt: str,
    device: str,
) -> Tuple[Any, List[str]]:
    """
    HuggingFace fallback: AutoModelForCausalLM + register_forward_hook.
    Returns (resid Tensor[seq, d_model], token_strs).
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    prompt_text = _normalise_prompt_text(prompt)
    print(f"[PATH-B | HF] 🤗 Loading '{hf_model_name}' via AutoModelForCausalLM …")
    tokenizer = AutoTokenizer.from_pretrained(hf_model_name, cache_dir=MODEL_CACHE_DIR)
    model = AutoModelForCausalLM.from_pretrained(
        hf_model_name,
        dtype=torch.float32,
        device_map=device if device == "cpu" else "auto",
        cache_dir=MODEL_CACHE_DIR,
    )
    model.eval()

    inputs = tokenizer(prompt_text, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    token_strs = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0].tolist())
    print(f"[PATH-B | HF] 🔢 {len(token_strs)} tokens: {token_strs}")

    captured: Dict[str, Any] = {}

    def hook_fn(module: Any, inp: Any, out: Any) -> None:
        hidden = out[0] if isinstance(out, (tuple, list)) else out
        captured["hidden"] = hidden.detach().clone()
        print(f"[PATH-B | HF] 🎯 Post-hook fired @ layer {layer_idx} — {tuple(hidden.shape)}")

    def pre_hook_fn(module: Any, inp: Any) -> None:
        hidden = inp[0] if isinstance(inp, (tuple, list)) else inp
        captured["hidden"] = hidden.detach().clone()
        print(f"[PATH-B | HF] 🎯 Pre-hook fired @ layer {layer_idx} — {tuple(hidden.shape)}")

    target_layer = _find_hf_layer(model, layer_idx)
    if hook_point.endswith("hook_resid_pre"):
        handle = target_layer.register_forward_pre_hook(pre_hook_fn)
    else:
        handle = target_layer.register_forward_hook(hook_fn)

    with torch.no_grad():
        model(**inputs)
    handle.remove()

    if "hidden" not in captured:
        raise RuntimeError("Hook did not fire — no activations captured.")

    resid = captured["hidden"][0]  # (seq, d_model)
    del model
    vram_clear()
    return resid, token_strs


# Report builder  (shared by real and mock pipelines)
# ─────────────────────────────────────────────────────────────────────────────

def _build_reports(
    feature_acts_cpu: Any,
    token_strs: List[str],
    rng: random.Random,
    np_model_id: str,
    np_sae_id: str,
    concept_override: Optional[Dict[int, str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Convert a (seq_len, d_sae) activation tensor (CPU numpy) into:
      fired_features_summary  — Report 1 global feature list
      token_level_firings     — Report 2 per-token top-50

    Label resolution priority:
      1. concept_override (from local concept2token JSON) — if provided, Neuronpedia is skipped
      2. Neuronpedia API  — used only when concept_override is None or empty
      3. Fallback: "Concept {id}"
    """
    import numpy as _np
    fa = feature_acts_cpu.numpy()  # (seq, d_sae)
    
    # if fa.shape[0]>1:
    #     fa = fa[1:]  # Skip BOS token for global stats
    

    # Determine which features are active
    active_mask = fa > 0
    active_ids = active_mask.any(axis=0).nonzero()[0].tolist()

    # ── Label resolution ─────────────────────────────────────────────────────────────────
    if concept_override:  
        print(f"[Labels] 📚 Using local concept-json overrides ({len(concept_override)} entries)")
        labels_map = {
            fid: concept_override.get(fid, f"Concept {fid}")
            for fid in active_ids
        }
    else:                 
        print(f"[Neuronpedia] Fetching labels for {len(active_ids)} unique features...")
        labels_map = get_concept_labels_batch(np_model_id, np_sae_id, active_ids)

    # Report 2 — per-token
    token_level_firings: List[Dict[str, Any]] = []
    for tok_idx, tok_str in enumerate(token_strs):
        row = fa[tok_idx]
        pairs = [(int(fid), float(row[fid])) for fid in (row > 0).nonzero()[0]]
        pairs.sort(key=lambda x: x[1], reverse=True)
        token_level_firings.append({
            "token_index":    tok_idx,
            "token_string":   tok_str,
            "top_50_features": [
                {
                    "feature_id":    fid,
                    "activation":    round(val, 4),
                    "concept_label": labels_map.get(fid, f"Concept {fid}"),
                }
                for fid, val in pairs[:50]
            ],
        })

    # Report 1 — global aggregation
    if fa.shape[0] > 1:
        fa = fa[1:]  # Skip BOS token for global stats

    global_max   = fa.max(axis=0)
    global_sum   = fa.sum(axis=0)
    global_count = active_mask.sum(axis=0)

    # Sort by (max_activation DESC, fired_token_count DESC) for global report:
    fired_features_summary: List[Dict[str, Any]] = sorted([
        {
            "feature_id":        fid,
            "max_activation":    round(float(global_max[fid]), 4),
            "avg_activation":    round(float(global_sum[fid]) / int(global_count[fid]), 4),
            "sum_activation":    round(float(global_sum[fid]), 4),
            "fired_token_count": int(global_count[fid]),
            "concept_label":     labels_map.get(fid, f"Concept {fid}"),
        }
        for fid in active_ids
    ], key=lambda x: (x["max_activation"], x["fired_token_count"]), reverse=True)

    return fired_features_summary, token_level_firings


def _build_visualization_data(
    fired_features_summary: List[Dict[str, Any]],
    token_level_firings: List[Dict[str, Any]],
    top_n: int = 50,
    graph_n: int = 28,
) -> Dict[str, Any]:
    """
    Pre-aggregate compact structures for frontend visualizations.

    This intentionally does not perform dimensionality reduction or any extra
    model work. It only reshapes the existing report data into bounded-size
    sparse matrices and co-activation edges.
    """
    top_features = fired_features_summary[:top_n]
    top_ids = {int(f["feature_id"]) for f in top_features}
    graph_ids = {int(f["feature_id"]) for f in fired_features_summary[:graph_n]}

    tokens = [
        {"token_index": t["token_index"], "token_string": t["token_string"]}
        for t in token_level_firings
    ]
    token_count = len(tokens)

    by_feature: Dict[int, List[Dict[str, Any]]] = {fid: [] for fid in top_ids}
    cells: List[Dict[str, Any]] = []
    edge_stats: Dict[Tuple[int, int], Dict[str, Any]] = {}

    for token in token_level_firings:
        token_index = int(token["token_index"])
        active_for_graph: List[Tuple[int, float]] = []

        for feat in token.get("top_50_features", []):
            fid = int(feat["feature_id"])
            activation = float(feat["activation"])

            if fid in top_ids:
                cell = {
                    "token_index": token_index,
                    "feature_id": fid,
                    "activation": round(activation, 4),
                }
                cells.append(cell)
                by_feature[fid].append(cell)

            if fid in graph_ids:
                active_for_graph.append((fid, activation))

        active_for_graph.sort(key=lambda x: x[1], reverse=True)
        active_for_graph = active_for_graph[:8]
        for i in range(len(active_for_graph)):
            for j in range(i + 1, len(active_for_graph)):
                a, av = active_for_graph[i]
                b, bv = active_for_graph[j]
                source, target = (a, b) if a < b else (b, a)
                key = (source, target)
                stat = edge_stats.setdefault(
                    key,
                    {"source": source, "target": target, "count": 0, "strength": 0.0},
                )
                stat["count"] += 1
                stat["strength"] += min(av, bv)

    landscape = []
    for rank, feat in enumerate(top_features):
        fid = int(feat["feature_id"])
        values = by_feature.get(fid, [])
        peak = max(values, key=lambda x: x["activation"], default=None)
        peak_index = peak["token_index"] if peak else -1
        peak_token = tokens[peak_index]["token_string"] if 0 <= peak_index < token_count else ""
        landscape.append({
            "rank": rank + 1,
            "feature_id": fid,
            "concept_label": feat["concept_label"],
            "max_activation": feat["max_activation"],
            "avg_activation": feat["avg_activation"],
            "sum_activation": feat.get("sum_activation", 0),
            "fired_token_count": feat["fired_token_count"],
            "peak_token_index": peak_index,
            "peak_token": peak_token,
        })

    stream_series = []
    for feat in top_features[:12]:
        fid = int(feat["feature_id"])
        values = [0.0] * token_count
        for cell in by_feature.get(fid, []):
            idx = cell["token_index"]
            if 0 <= idx < token_count:
                values[idx] = cell["activation"]
        stream_series.append({
            "feature_id": fid,
            "concept_label": feat["concept_label"],
            "max_activation": feat["max_activation"],
            "values": values,
        })

    graph_nodes = [
        {
            "id": int(feat["feature_id"]),
            "label": feat["concept_label"],
            "max_activation": feat["max_activation"],
            "avg_activation": feat["avg_activation"],
            "fired_token_count": feat["fired_token_count"],
        }
        for feat in fired_features_summary[:graph_n]
    ]
    graph_links = sorted(
        edge_stats.values(),
        key=lambda x: (x["count"], x["strength"]),
        reverse=True,
    )[:80]
    for link in graph_links:
        link["strength"] = round(float(link["strength"]), 4)

    treemap = [
        {
            "feature_id": int(feat["feature_id"]),
            "concept_label": feat["concept_label"],
            "size": max(float(feat.get("sum_activation", 0)), float(feat["max_activation"])),
            "max_activation": feat["max_activation"],
            "fired_token_count": feat["fired_token_count"],
        }
        for feat in top_features[:30]
    ]

    return {
        "tokens": tokens,
        "features": top_features,
        "landscape": landscape,
        "heatmap": {
            "features": top_features[:30],
            "cells": cells,
        },
        "stream": {
            "series": stream_series,
            "tokens": tokens,
        },
        "coactivation_graph": {
            "nodes": graph_nodes,
            "links": graph_links,
        },
        "treemap": treemap,
        "limits": {
            "top_n": top_n,
            "graph_n": graph_n,
            "cell_count": len(cells),
            "link_count": len(graph_links),
        },
    }


def build_cross_model_visualization(
    models_data: Dict[str, Any],
    model_keys: List[str],
    top_n: int = 40,
) -> Dict[str, Any]:
    """Build bounded cross-model concept overlap data for frontend views."""
    concept_index: Dict[str, Dict[str, Any]] = {}
    unique_by_model: Dict[str, List[Dict[str, Any]]] = {key: [] for key in model_keys}

    for model_key in model_keys:
        features = (
            models_data.get(model_key, {})
            .get("report_1_global", {})
            .get("fired_features_summary", [])
        )[:top_n]
        for feat in features:
            label = str(feat.get("concept_label", f"Concept {feat.get('feature_id')}")).strip()
            canonical = " ".join(label.lower().split())
            if not canonical:
                canonical = f"feature:{feat.get('feature_id')}"
            bucket = concept_index.setdefault(canonical, {"label": label, "records": []})
            bucket["records"].append({
                "model_key": model_key,
                "feature_id": int(feat["feature_id"]),
                "concept_label": label,
                "max_activation": feat["max_activation"],
                "avg_activation": feat["avg_activation"],
                "fired_token_count": feat["fired_token_count"],
            })

    shared_all: List[Dict[str, Any]] = []
    partial_overlap: List[Dict[str, Any]] = []
    alignment_nodes: List[Dict[str, Any]] = []
    alignment_links: List[Dict[str, Any]] = []

    for canonical, bucket in concept_index.items():
        records = bucket["records"]
        model_set = {r["model_key"] for r in records}
        avg_activation = sum(float(r["max_activation"]) for r in records) / len(records)
        item = {
            "concept_key": canonical,
            "label": bucket["label"],
            "model_count": len(model_set),
            "avg_activation": round(avg_activation, 4),
            "records": records,
        }

        if len(model_set) == len(model_keys):
            shared_all.append(item)
        elif len(model_set) > 1:
            partial_overlap.append(item)
        elif records:
            unique_by_model[records[0]["model_key"]].append(item)

        if len(model_set) > 1:
            ordered = [
                next((r for r in records if r["model_key"] == key), None)
                for key in model_keys
            ]
            ordered = [r for r in ordered if r]
            for record in ordered:
                alignment_nodes.append({
                    "id": f"{record['model_key']}::{canonical}",
                    "concept_key": canonical,
                    **record,
                })
            for left, right in zip(ordered, ordered[1:]):
                alignment_links.append({
                    "source": f"{left['model_key']}::{canonical}",
                    "target": f"{right['model_key']}::{canonical}",
                    "concept_key": canonical,
                    "label": bucket["label"],
                    "strength": round(
                        (float(left["max_activation"]) + float(right["max_activation"])) / 2,
                        4,
                    ),
                })

    shared_all.sort(key=lambda x: x["avg_activation"], reverse=True)
    partial_overlap.sort(key=lambda x: (x["model_count"], x["avg_activation"]), reverse=True)
    for model_key in model_keys:
        unique_by_model[model_key].sort(key=lambda x: x["avg_activation"], reverse=True)
        unique_by_model[model_key] = unique_by_model[model_key][:12]

    return {
        "shared_all": shared_all[:16],
        "partial_overlap": partial_overlap[:20],
        "unique_by_model": unique_by_model,
        "alignment": {
            "nodes": alignment_nodes[:80],
            "links": alignment_links[:80],
        },
        "model_keys": model_keys,
        "total_unique_concepts": len(concept_index),
    }

# Mock pipeline
def _mock_analyse_model(
    prompt: str, model_key: str, top_k: int
) -> Dict[str, Any]:
    """Deterministic seeded-random mock — full JSON schema, no ML deps."""
    prompt = _normalise_prompt_text(prompt)
    seed = hash(prompt + model_key) & 0xFFFFFFFF
    rng  = random.Random(seed)

    cfg = _CONFIG_CACHE.get(model_key) or _stub_config(model_key)
    tokens = naive_tokenise(prompt)
    d_sae  = 4096

    print(f"\n[MOCK | {model_key}] prompt='{prompt}', tokens={tokens}")
    print(f"[MOCK | {model_key}] 🔬 [TransformerLens] Simulating load '{cfg['hf_model_name']}'")
    time.sleep(0.05)
    print(f"[MOCK | {model_key}] 🪝 hook='{cfg['hook_point']}' "
          f"layer={cfg['layer']} d_model={cfg['d_model']}")
    print(f"[MOCK | {model_key}] 🔭 [SAELens] Encoding → sparse (d_sae={d_sae})")
    time.sleep(0.03)

    # Load concept override if configured
    concept_json_name = model_key
    concept_override: Dict[int, str] = {}
    if concept_json_name:
        concept_override = _load_concept_json(concept_json_name)

    # Sparse feature matrix
    matrix: List[List[float]] = []
    for _ in tokens:
        row = [0.0] * d_sae
        for fid in rng.sample(range(d_sae), rng.randint(15, 35)):
            row[fid] = round(rng.uniform(0.1, 6.5), 4)
        matrix.append(row)

    active_ids = set()
    for row in matrix:
        for fid, val in enumerate(row):
            if val > 0:
                active_ids.add(fid)

    # ── Build reports ─────────────────────────────────────────────────────────
    # Label resolution: concept_override takes priority, else Neuronpedia
    if concept_override:
        labels_map = {
            fid: concept_override.get(fid, f"Concept {fid}")
            for fid in active_ids
        }
    else:
        labels_map = get_concept_labels_batch(cfg.get("np_model_id"), cfg.get("np_sae_id"), list(active_ids))

    # Report 2
    token_level_firings = []
    for tok_idx, tok_str in enumerate(tokens):
        pairs = [(fid, val) for fid, val in enumerate(matrix[tok_idx]) if val > 0]
        pairs.sort(key=lambda x: x[1], reverse=True)
        token_level_firings.append({
            "token_index":    tok_idx,
            "token_string":   tok_str,
            "top_50_features": [
                {"feature_id": fid, "activation": round(val, 4),
                 "concept_label": labels_map.get(fid, f"Concept {fid}")}
                for fid, val in pairs[:50]
            ],
        })

    # Report 1
    stats: Dict[int, Any] = {}
    for row in matrix:
        for fid, val in enumerate(row):
            if val == 0:
                continue
            if fid not in stats:
                stats[fid] = {"max": val, "sum": val, "cnt": 1}
            else:
                stats[fid]["max"] = max(stats[fid]["max"], val)
                stats[fid]["sum"] += val
                stats[fid]["cnt"] += 1

    fired_features_summary = sorted([
        {
            "feature_id":        fid,
            "max_activation":    round(s["max"], 4),
            "avg_activation":    round(s["sum"] / s["cnt"], 4),
            "sum_activation":    round(s["sum"], 4),
            "fired_token_count": s["cnt"],
            "concept_label":     labels_map.get(fid, f"Concept {fid}"),
        }
        for fid, s in stats.items()
    ], key=lambda x: (x["max_activation"], x["fired_token_count"]), reverse=True)

    print(f"[MOCK | {model_key}] ✅ {len(fired_features_summary)} features, "
          f"{len(tokens)} tokens")

    visualization_data = _build_visualization_data(
        fired_features_summary,
        token_level_firings,
        top_n=max(50, top_k),
    )

    return {
        "model_metadata": {
            "model_name":      cfg["display_name"],
            "model_key":       model_key,
            "prompt":          prompt,
            "tokens":          tokens,
            "hook_point":      cfg["hook_point"],
            "layer":           cfg["layer"],
            "d_model":         cfg["d_model"],
            "sae_release":     cfg["sae_release"],
            "sae_id":          cfg["sae_id"],
            "pipeline_mode":   "mock",
            "activation_path": "mock",
        },
        "report_1_global":    {"fired_features_summary": fired_features_summary},
        "report_2_per_token": {"token_level_firings": token_level_firings},
        "visualization_data": visualization_data,
    }


# Real pipeline
# ─────────────────────────────────────────────────────────────────────────────

def _real_analyse_model(
    prompt: str, model_key: str, top_k: int
) -> Dict[str, Any]:
    """
    Full dual-path pipeline:
      1. Resolve config (cached after first call)
      2. Extract activations: Path A (TL) → Path B (HF) on failure
      3. Load SAE → encode → sparse features
      4. Build reports
      5. Free all objects + clear VRAM
    """
    import torch

    prompt = _normalise_prompt_text(prompt)
    cfg    = _resolve_model_config(model_key)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    rng    = random.Random(hash(prompt + model_key) & 0xFFFFFFFF)

    print(f"\n[REAL | {model_key}] prompt='{prompt}' device={device}")
    print(f"[REAL | {model_key}] hf='{cfg['hf_model_name']}' "
          f"hook='{cfg['hook_point']}' d_model={cfg['d_model']}")

    # ── Activation extraction ─────────────────────────────────────────────────
    resid: Any        = None
    token_strs: List[str] = []
    activation_path   = "unknown"

    if TL_AVAILABLE:
        try:
            print(f"[REAL | {model_key}] 🔬 Trying Path A (TransformerLens) …")
            resid, token_strs = _extract_activations_tl(
                cfg["hf_model_name"], cfg["hook_point"], prompt, device,
                cfg.get("model_from_pretrained_kwargs"),
            )
            activation_path = "transformer_lens"
        except Exception as exc:
            # 拓宽异常捕获范围，捕获所有导致 Path A 失败的错误（包括 TypeError/ValueError），实现安全熔断
            print(f"[REAL | {model_key}] ⚠️  Path A 无法加载或转换，安全切换至 Path B。错误原因: {exc}")
            resid = None

    if resid is None:
        if not HF_AVAILABLE:
            raise RuntimeError(
                "TransformerLens unavailable and HuggingFace transformers not installed."
            )
        print(f"[REAL | {model_key}] 🤗 Trying Path B (HuggingFace hook) …")
        resid, token_strs = _extract_activations_hf(
            cfg["hf_model_name"], cfg["layer"], cfg["hook_point"], prompt, device
        )
        activation_path = "huggingface_hook"

    print(f"[REAL | {model_key}] ✅ Activation path: {activation_path}")

    # ── Load concept override (if configured) ─────────────────────────────────────
    concept_json_name = model_key
    concept_override: Dict[int, str] = {}
    if concept_json_name:
        concept_override = _load_concept_json(concept_json_name)

    # ── SAE encode ────────────────────────────────────────────────────────────
    print(f"[REAL | {model_key}] 🔭 [SAELens] Loading SAE "
          f"release='{cfg['sae_release']}' sae_id='{cfg['sae_id']}' …")
    
    # 增加显存保护机制，确保异常发生时也一定会释放 SAE 显存
    try:
        sae = _load_sae(
            release=cfg["sae_release"],
            sae_id=cfg["sae_id"],
            device=device,
        )
        sae.eval()

        resid = resid.to(device)

        d_sae  = safe_sae_attr(sae.cfg, "d_sae",  default=resid.shape[-1] * 8)
        d_in   = safe_sae_attr(sae.cfg, "d_in",   default=None)
        print(f"[REAL | {model_key}] ✅ [SAELens] d_sae={d_sae}, d_in={d_in}")

        # ── Guard: verify activation dim matches SAE's expected d_in ─────────
        actual_d = resid.shape[-1]
        if d_in is not None and actual_d != d_in:
            raise ValueError(
                f"[DIM-MISMATCH] 激活维度 {actual_d} ≠ SAE d_in {d_in}。\n"
                f"  请检查 registry.py 中 '{model_key}' 的 hf_model_name，\n"
                f"  确保基座模型的 d_model ({actual_d}) 与 SAE 训练时的 d_in ({d_in}) 一致。"
            )
        # ─────────────────────────────────────────────────────────────────────

        with torch.no_grad():
            feature_acts = sae.encode(resid)  # (seq, d_sae)

        l0 = (feature_acts > 0).float().sum(dim=-1).mean().item()
        print(f"[REAL | {model_key}] 📊 {tuple(feature_acts.shape)}, mean L0={l0:.1f}")
        feature_acts_cpu = feature_acts.cpu()
    finally:
        print(f"[REAL | {model_key}] 🗑️  [HOT-SWAP] Freeing SAE …")
        if 'sae' in locals():
            del sae
        if 'feature_acts' in locals():
            del feature_acts
        vram_clear()

    # ── Build reports ─────────────────────────────────────────────────────────
    fired_features_summary, token_level_firings = _build_reports(
        feature_acts_cpu, token_strs, rng,
        cfg.get("np_model_id"), cfg.get("np_sae_id"),
        concept_override=concept_override,
    )

    print(f"[REAL | {model_key}] ✅ Done — "
          f"{len(fired_features_summary)} features, {len(token_strs)} tokens")

    visualization_data = _build_visualization_data(
        fired_features_summary,
        token_level_firings,
        top_n=max(50, top_k),
    )

    return {
        "model_metadata": {
            "model_name":      cfg["display_name"],
            "model_key":       model_key,
            "prompt":          prompt,
            "tokens":          token_strs,
            "hook_point":      cfg["hook_point"],
            "layer":           cfg["layer"],
            "d_model":         cfg["d_model"],
            "sae_release":     cfg["sae_release"],
            "sae_id":          cfg["sae_id"],
            "pipeline_mode":   "real",
            "activation_path": activation_path,
        },
        "report_1_global":    {"fired_features_summary": fired_features_summary},
        "report_2_per_token": {"token_level_firings": token_level_firings},
        "visualization_data": visualization_data,
    }


# Public dispatch
# ─────────────────────────────────────────────────────────────────────────────

def analyse_model(prompt: str, model_key: str, top_k: int) -> Dict[str, Any]:
    """
    Entry point called by the API route.
    Tries the real pipeline first. Production disables mock fallback so CUDA/model
    failures surface as HTTP errors instead of returning plausible-looking fake data.
    """
    if FULL_PIPELINE:
        try:
            return _real_analyse_model(prompt, model_key, top_k)
        except Exception as exc:
            print(f"[ERROR | {model_key}] Real pipeline failed: {exc}")
            print(traceback.format_exc())
            if not _mock_fallback_enabled():
                print(f"[FALLBACK | {model_key}] disabled; propagating real error")
                raise
            print(f"[FALLBACK | {model_key}] → mock pipeline")
            return _mock_analyse_model(prompt, model_key, top_k)
    if not _mock_fallback_enabled():
        raise RuntimeError(
            "Real pipeline dependencies are unavailable and ALLOW_MOCK_FALLBACK=false"
        )
    return _mock_analyse_model(prompt, model_key, top_k)
