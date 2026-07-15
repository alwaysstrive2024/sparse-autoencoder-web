// ─── API ────────────────────────────────────────────────────────────────────
// Local dev    → http://localhost:8000  (direct to FastAPI)
// K8s / prod   → /api  (nginx in the frontend pod reverse-proxies /api/* to
//                       the internal sae-backend-svc K8s service)
// `|| '/api'` 也会把未定义或空字符串安全回退为同源相对路径，避免把
// 域名/IP 硬编码进生产构建产物。
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// Mirrors backend/registry.py so the selector can still show every registered
// model while the backend is starting or temporarily unavailable.
export const FALLBACK_MODELS = [
  {
    key: 'pythia-70m',
    display_name: 'Pythia 70M',
    sae_release: 'pythia-70m-deduped-res-jb',
    sae_id: 'res-jb',
  },
  {
    key: 'gemma-2b',
    display_name: 'Gemma 2B',
    sae_release: 'gemma-2b-res-jb',
    sae_id: 'blocks.12.hook_resid_post',
  },
  {
    key: 'llama-3.2-1b',
    display_name: 'Llama 3.2 1B',
    sae_release: 'llama-3.2-1b-res-jb',
    sae_id: 'blocks.8.hook_resid_post',
  },
  {
    key: 'gemma-4-e2b-l6',
    display_name: 'Gemma-4-E2B (Layer 6)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e2b/btk-mat-layer-6-k-100',
  },
  {
    key: 'gemma-4-e2b-l17',
    display_name: 'Gemma-4-E2B (Layer 17)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e2b/btk-mat-layer-17-k-100',
  },
  {
    key: 'gemma-4-e2b-l28',
    display_name: 'Gemma-4-E2B (Layer 28)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e2b/btk-mat-layer-28-k-100',
  },
  {
    key: 'gemma-4-e4b-l7',
    display_name: 'Gemma-4-E4B (Layer 7)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e4b/btk-mat-layer-7-k-100',
  },
  {
    key: 'gemma-4-e4b-l21',
    display_name: 'Gemma-4-E4B (Layer 21)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e4b/btk-mat-layer-21-k-100',
  },
  {
    key: 'gemma-4-e4b-l35',
    display_name: 'Gemma-4-E4B (Layer 35)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-e4b/btk-mat-layer-35-k-100',
  },
  {
    key: 'gemma-4-31b-l30',
    display_name: 'Gemma-4-31B (Layer 30)',
    sae_release: 'decoderesearch/gemma-4-saes',
    sae_id: 'gemma-4-31b/btk-mat-layer-30-k-100',
  },
];

// ─── Per-model colour tokens (Slot-based) ────────────────────────────────────
export const SLOT_COLORS = [
  {
    // Slot 0: Tsinghua purple
    accent: '#82318e',
    accentDark: '#5f1f69',
    gradient: 'linear-gradient(135deg, #5f1f69 0%, #82318e 54%, #b258c2 100%)',
    gradientBar: 'linear-gradient(90deg, #5f1f69, #82318e, #b258c2)',
    glow: 'rgba(130, 49, 142, 0.32)',
    ring: 'rgba(130, 49, 142, 0.62)',
    bg: 'rgba(130, 49, 142, 0.13)',
    bgHover: 'rgba(130, 49, 142, 0.20)',
    text: '#5f1f69',
    border: 'rgba(130, 49, 142, 0.42)',
    tag: 'TL+SAE',
  },
  {
    // Slot 1: Tsinghua blue
    accent: '#1661ab',
    accentDark: '#0d3f7a',
    gradient: 'linear-gradient(135deg, #0d3f7a 0%, #1661ab 58%, #4b8bd6 100%)',
    gradientBar: 'linear-gradient(90deg, #0d3f7a, #1661ab, #4b8bd6)',
    glow: 'rgba(22, 97, 171, 0.32)',
    ring: 'rgba(22, 97, 171, 0.62)',
    bg: 'rgba(22, 97, 171, 0.13)',
    bgHover: 'rgba(22, 97, 171, 0.20)',
    text: '#0d3f7a',
    border: 'rgba(22, 97, 171, 0.42)',
    tag: 'TL+SAE',
  },
  {
    // Slot 2: Blue-purple bridge
    accent: '#4f46e5',
    accentDark: '#3730a3',
    gradient: 'linear-gradient(135deg, #3730a3 0%, #4f46e5 52%, #7c3aed 100%)',
    gradientBar: 'linear-gradient(90deg, #3730a3, #4f46e5, #7c3aed)',
    glow: 'rgba(79, 70, 229, 0.30)',
    ring: 'rgba(79, 70, 229, 0.58)',
    bg: 'rgba(79, 70, 229, 0.12)',
    bgHover: 'rgba(79, 70, 229, 0.18)',
    text: '#3730a3',
    border: 'rgba(79, 70, 229, 0.38)',
    tag: 'TL+SAE',
  },
];

export const DEFAULT_COLOR = {
  accent: '#82318e',
  accentDark: '#5f1f69',
  gradient: 'linear-gradient(135deg, #5f1f69 0%, #82318e 55%, #1661ab 100%)',
  gradientBar: 'linear-gradient(90deg, #5f1f69, #82318e, #1661ab)',
  glow: 'rgba(130, 49, 142, 0.32)',
  ring: 'rgba(130, 49, 142, 0.62)',
  bg: 'rgba(130, 49, 142, 0.13)',
  bgHover: 'rgba(130, 49, 142, 0.20)',
  text: '#5f1f69',
  border: 'rgba(130, 49, 142, 0.42)',
  tag: 'TL+SAE',
};

export function getModelColor(slotIndex) {
  if (typeof slotIndex !== 'number' || slotIndex < 0) return DEFAULT_COLOR;
  return SLOT_COLORS[slotIndex % SLOT_COLORS.length];
}

// ─── Loading overlay pipeline steps ──────────────────────────────────────────
// Each step belongs to a visible tool family (LLM | XAI | HOT-SWAP)
export const PIPELINE_STEPS = [
  {
    icon: '🔬',
    tool: 'LLM',
    toolColor: '#82318e',
    text: (modelName) => `Loading ${modelName} via HookedTransformer.from_pretrained()…`,
  },
  {
    icon: '🪝',
    tool: 'LLM',
    toolColor: '#82318e',
    text: () => 'Registering residual-stream hook at target layer…',
  },
  {
    icon: '▶️',
    tool: 'LLM',
    toolColor: '#82318e',
    text: () => 'Running forward pass — intercepting activation tensor…',
  },
  {
    icon: '🔭',
    tool: 'XAI',
    toolColor: '#1661ab',
    text: () => 'Loading pre-trained SAE weights from HuggingFace…',
  },
  {
    icon: '✨',
    tool: 'XAI',
    toolColor: '#1661ab',
    text: () => 'Encoding dense activations → sparse interpretable features…',
  },
  {
    icon: '📊',
    tool: 'XAI',
    toolColor: '#1661ab',
    text: () => 'Building Report 1 (global) and Report 2 (per-token)…',
  },
  {
    icon: '🗑️',
    tool: 'HOT-SWAP',
    toolColor: '#4f46e5',
    text: () => 'Deleting model objects — clearing VRAM for next model…',
  },
];
