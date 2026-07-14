"""
preprocessing.py — Prompt normalization before model analysis.

Chinese input handling is driven by model registry metadata. When any selected
model is configured for English preprocessing, the prompt is translated once and
shared by the whole analysis request.
"""

from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Any, Dict, List

from registry import MODEL_REGISTRY

DEFAULT_ZH_EN_TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-zh-en"
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_SENTENCE_SPLIT_RE = re.compile(r"([^。！？!?；;\n]+[。！？!?；;\n]?)")


@dataclass(frozen=True)
class PromptPreprocessResult:
    original_prompt: str
    model_prompt: str
    detected_language: str
    translated: bool
    translation_model: str | None
    translation_required_by: List[str]

    def to_metadata(self) -> Dict[str, Any]:
        return asdict(self)


def contains_chinese(text: str) -> bool:
    """Return True when the text contains CJK ideographs."""
    return bool(_CJK_RE.search(text or ""))


def _translation_required_by(model_keys: List[str]) -> List[str]:
    required: List[str] = []
    for key in model_keys:
        entry = MODEL_REGISTRY.get(key, {})
        if entry.get("chinese_input_policy") == "translate_to_en":
            required.append(key)
    return required


def preprocess_prompt_for_models(prompt: str, model_keys: List[str]) -> PromptPreprocessResult:
    """
    Prepare the single prompt that all selected models should analyze.

    If the prompt contains Chinese and at least one selected model requires
    English preprocessing, translate once and reuse that English text across all
    selected models so cross-model comparisons stay aligned.
    """
    original_prompt = str(prompt)
    required_by = _translation_required_by(model_keys)
    detected_language = "zh" if contains_chinese(original_prompt) else "unknown"

    if not required_by or detected_language != "zh":
        return PromptPreprocessResult(
            original_prompt=original_prompt,
            model_prompt=original_prompt,
            detected_language=detected_language,
            translated=False,
            translation_model=None,
            translation_required_by=required_by,
        )

    translation_model = os.getenv("ZH_EN_TRANSLATION_MODEL", DEFAULT_ZH_EN_TRANSLATION_MODEL)
    model_prompt = translate_zh_to_en(original_prompt, translation_model)
    return PromptPreprocessResult(
        original_prompt=original_prompt,
        model_prompt=model_prompt,
        detected_language=detected_language,
        translated=True,
        translation_model=translation_model,
        translation_required_by=required_by,
    )


def translate_zh_to_en(text: str, model_name: str | None = None) -> str:
    """Translate Chinese text to English with a cached local seq2seq model."""
    model_name = model_name or os.getenv("ZH_EN_TRANSLATION_MODEL", DEFAULT_ZH_EN_TRANSLATION_MODEL)
    translator = _get_translator(model_name)
    chunks = _chunk_text(text)
    translations: List[str] = []
    for chunk in chunks:
        result = _translate_chunk(chunk, translator)
        if not result:
            raise RuntimeError("Chinese-to-English translation returned an empty result.")
        translations.append(result.strip())
    return " ".join(part for part in translations if part).strip()


@lru_cache(maxsize=2)
def _get_translator(model_name: str) -> Any:
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    device = _translation_device()
    torch_device = torch.device("cpu" if device < 0 else f"cuda:{device}")
    print(f"[PREPROCESS] Loading zh->en translator '{model_name}' on device={torch_device}")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    model.to(torch_device)
    model.eval()
    return {
        "tokenizer": tokenizer,
        "model": model,
        "device": torch_device,
    }


def _translate_chunk(chunk: str, translator: Dict[str, Any]) -> str:
    import torch

    tokenizer = translator["tokenizer"]
    model = translator["model"]
    device = translator["device"]
    inputs = tokenizer(
        chunk,
        return_tensors="pt",
        truncation=True,
        max_length=512,
    )
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=256,
            num_beams=4,
            early_stopping=True,
        )
    return tokenizer.decode(output_ids[0], skip_special_tokens=True)


def _translation_device() -> int:
    """
    Default to CPU so the translator does not reserve VRAM needed by the hot-swap
    interpretability pipeline. Set ZH_EN_TRANSLATION_DEVICE=auto to use CUDA.
    """
    configured = os.getenv("ZH_EN_TRANSLATION_DEVICE", "cpu").strip().lower()
    if configured in {"cpu", "-1", ""}:
        return -1
    if configured == "auto":
        try:
            import torch

            return 0 if torch.cuda.is_available() else -1
        except ImportError:
            return -1
    try:
        return int(configured)
    except ValueError:
        return -1


def _chunk_text(text: str, max_chars: int = 420) -> List[str]:
    """
    Split long prompts into sentence-like chunks under the Marian model's input
    budget. Character-based chunking is conservative and fast for short prompts.
    """
    pieces = [m.group(0).strip() for m in _SENTENCE_SPLIT_RE.finditer(text) if m.group(0).strip()]
    if not pieces:
        pieces = [text.strip()]

    chunks: List[str] = []
    current = ""
    for piece in pieces:
        if len(piece) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(piece[i : i + max_chars] for i in range(0, len(piece), max_chars))
            continue

        next_chunk = f"{current} {piece}".strip() if current else piece
        if len(next_chunk) > max_chars:
            if current:
                chunks.append(current)
            current = piece
        else:
            current = next_chunk

    if current:
        chunks.append(current)
    return chunks
