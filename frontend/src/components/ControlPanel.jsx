import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, X, ChevronDown, Cpu, SlidersHorizontal, Play, Check, Search } from 'lucide-react';

/**
 * ControlPanel
 * Top section of the dashboard containing:
 *  - Prompt textarea
 *  - Dynamic model selector (up to 3, each with dropdown + remove)
 *  - Top-K slider
 *  - Run button
 *
 * Props:
 *   availableModels  {object[]}
 *   selectedModels   {object[]}  — [{id, modelKey}]
 *   setSelectedModels
 *   prompt / setPrompt
 *   topK / setTopK
 *   onRun / isLoading
 */
export default function ControlPanel({
  availableModels,
  selectedModels,
  setSelectedModels,
  prompt,
  setPrompt,
  topK,
  setTopK,
  onRun,
  isLoading,
}) {
  const baseId = useId();
  const MAX_MODELS = 3;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const addModel = () => {
    if (selectedModels.length >= MAX_MODELS) return;
    setSelectedModels((prev) => [...prev, { id: `${baseId}-${Date.now()}`, modelKey: '' }]);
  };

  const removeModel = (id) => {
    setSelectedModels((prev) => prev.filter((m) => m.id !== id));
  };

  const updateModelKey = (id, modelKey) => {
    setSelectedModels((prev) => prev.map((m) => (m.id === id ? { ...m, modelKey } : m)));
  };

  // Which model keys are already chosen (for disabling duplicates in other selectors)
  const chosenKeys = selectedModels.map((m) => m.modelKey).filter(Boolean);
  const canRun =
    !isLoading &&
    prompt.trim().length > 0 &&
    chosenKeys.length > 0 &&
    selectedModels.every((m) => m.modelKey);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="glass-card relative z-30 p-6 space-y-5 animate-fade-up">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <div
          className="w-1 h-5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #82318e, #1661ab)' }}
        />
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
          Control Panel
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
        {/* ── Left: prompt + model selectors ── */}
        <div className="space-y-4">
          {/* Prompt textarea */}
          <div>
            <label
              htmlFor="prompt-input"
              className="block text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider"
            >
              Input Prompt
            </label>
            <textarea
              id="prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="input-base w-full px-4 py-3 text-sm resize-none leading-relaxed"
              placeholder="Enter a sentence to analyse… e.g. Apple announced iPhone 18 at WWDC."
            />
          </div>

          {/* Model selectors */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu size={11} className="opacity-60" />
                Models to Compare
              </label>
              <button
                id="add-model-btn"
                onClick={addModel}
                disabled={selectedModels.length >= MAX_MODELS}
                className="btn-ghost text-xs flex items-center gap-1 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <Plus size={12} />
                Add Model
                {selectedModels.length > 0 && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{ background: 'rgba(130,49,142,0.18)', color: '#5f1f69' }}
                  >
                    {selectedModels.length}/{MAX_MODELS}
                  </span>
                )}
              </button>
            </div>

            {/* Empty state hint */}
            {selectedModels.length === 0 && (
              <div
                className="flex items-center justify-center gap-2 rounded-xl py-4 text-sm text-white/25"
                style={{ border: '1px dashed rgba(22,97,171,0.32)', background: 'rgba(22,97,171,0.075)' }}
              >
                <Plus size={14} className="opacity-50" />
                Click &quot;Add Model&quot; to select up to 3 LLMs to compare
              </div>
            )}

            {/* Model selector rows */}
            <div className="space-y-2">
              {selectedModels.map((m, i) => (
                <ModelSelectorRow
                  key={m.id}
                  rowId={m.id}
                  index={i}
                  modelKey={m.modelKey}
                  availableModels={availableModels}
                  chosenKeys={chosenKeys}
                  onUpdate={updateModelKey}
                  onRemove={removeModel}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: top-K + run button ── */}
        <div className="flex flex-col gap-4 lg:w-52">
          {/* Top-K control */}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'rgba(239,245,255,0.92)', border: '1px solid rgba(22,97,171,0.26)' }}
          >
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal size={11} className="text-white/40" />
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                Top-K Features
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="topk-slider"
                type="range"
                min={1}
                max={50}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="flex-1 accent-indigo-500"
                style={{ accentColor: '#82318e' }}
              />
              <span
                className="mono text-sm font-bold w-8 text-center rounded-lg px-1 py-0.5"
                style={{ background: 'rgba(130,49,142,0.18)', color: '#5f1f69' }}
              >
                {topK}
              </span>
            </div>

            <p className="text-[10px] text-white/25 leading-snug">
              Tokens shown per model column. Range 1–50.
            </p>
          </div>

          {/* Run button */}
          <button
            id="run-comparison-btn"
            onClick={onRun}
            disabled={!canRun}
            className="btn-primary flex-1 text-sm font-bold relative overflow-hidden group disabled:opacity-75 disabled:cursor-not-allowed"
            style={{
              background: canRun
                ? 'linear-gradient(135deg, #5f1f69 0%, #82318e 48%, #1661ab 100%)'
                : 'rgba(22,97,171,0.14)',
              color: canRun ? 'white' : 'rgba(11,18,32,0.66)',
              boxShadow: canRun ? '0 14px 32px rgba(130,49,142,0.34)' : 'none',
              minHeight: '58px',
            }}
          >
            {/* Shimmer on hover */}
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
                backgroundSize: '200% auto',
              }}
            />
            <Play size={15} className="relative z-10" />
            <span className="relative z-10">Run Comparison</span>
          </button>

          {/* Pipeline mode legend */}
          <div className="text-[10px] text-white/25 text-center space-y-1">
            <div className="flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#82318e' }} />
              <span>LLM</span>
            </div>
            <div className="flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#1661ab' }} />
              <span>XAI</span>
            </div>
            <div className="flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4f46e5' }} />
              <span>VRAM Hot-Swap</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Model selector row ────────────────────────────────────────────────────── */
const MODEL_ACCENT = {
  'pythia-70m': { color: '#6f237a', bg: 'rgba(130,49,142,0.16)' },
  'gemma-2b':   { color: '#104f91', bg: 'rgba(22,97,171,0.16)' },
  'llama-3.2-1b': { color: '#3730a3', bg: 'rgba(79,70,229,0.15)' },
};

function ModelSelectorRow({ rowId, index, modelKey, availableModels, chosenKeys, onUpdate, onRemove }) {
  const labelColors = ['#82318e', '#1661ab', '#4f46e5'];
  const accentColor = labelColors[index] ?? '#82318e';
  const accent = MODEL_ACCENT[modelKey] ?? { color: accentColor, bg: `${accentColor}18` };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const selectedModel = availableModels.find((model) => model.key === modelKey);
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return availableModels;
    return availableModels.filter((model) => {
      const displayName = String(model.display_name ?? model.key).toLowerCase();
      return displayName.includes(normalized) || String(model.key).toLowerCase().includes(normalized);
    });
  }, [availableModels, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const chooseModel = (nextKey) => {
    onUpdate(rowId, nextKey);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex items-center gap-2 animate-fade-up"
      style={{ animationDelay: `${index * 60}ms`, zIndex: open ? 40 : 4 - index }}
    >
      {/* Index badge */}
      <span
        className="mono text-[10px] font-bold w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: `${labelColors[index]}22`, color: labelColors[index] }}
      >
        {index + 1}
      </span>

      {/* Dropdown */}
      <div className="relative flex-1">
        <button
          id={`model-select-${rowId}`}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="group flex w-full items-center gap-2 rounded-xl border px-3 py-2 pr-8 text-left text-sm font-semibold outline-none transition-all"
          style={
            modelKey
              ? {
                  borderColor: accent.color + '66',
                  background: `linear-gradient(135deg, ${accent.bg}, rgba(255,255,255,0.92))`,
                  color: accent.color,
                  boxShadow: `0 8px 22px ${accent.color}18`,
                }
              : {
                  borderColor: 'rgba(130,49,142,0.22)',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(239,245,255,0.92))',
                  color: 'rgba(11,18,32,0.62)',
                }
          }
          onFocus={(e) => {
            e.currentTarget.style.borderColor = accent.color;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${accent.color}22, 0 10px 24px ${accent.color}18`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = modelKey ? `${accent.color}66` : 'rgba(130,49,142,0.22)';
            e.currentTarget.style.boxShadow = modelKey ? `0 8px 22px ${accent.color}18` : 'none';
          }}
        >
          <span
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
            style={{
              background: modelKey ? `${accent.color}18` : 'rgba(130,49,142,0.10)',
              color: modelKey ? accent.color : 'rgba(130,49,142,0.62)',
              border: `1px solid ${modelKey ? `${accent.color}28` : 'rgba(130,49,142,0.16)'}`,
            }}
          >
            {selectedModel ? index + 1 : '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${selectedModel ? 'text-slate-800' : 'text-slate-500'}`}>
              {selectedModel?.display_name ?? selectedModel?.key ?? 'Select a model...'}
            </span>
            <span className="mono mt-0.5 block truncate text-[9px] font-medium text-white/30">
              {selectedModel?.key ?? 'Choose up to 3 models'}
            </span>
          </span>
        </button>
        <ChevronDown
          size={13}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: modelKey ? accent.color : 'rgba(130,49,142,0.52)' }}
        />

        {open && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.96)',
              borderColor: `${accent.color}38`,
              boxShadow: `0 22px 54px ${accent.color}22, 0 0 0 1px rgba(255,255,255,0.80) inset`,
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
          >
            <div
              className="border-b p-2"
              style={{
                borderColor: 'rgba(22,97,171,0.12)',
                background: 'linear-gradient(135deg, rgba(239,245,255,0.90), rgba(255,255,255,0.92))',
              }}
            >
              <div
                className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
                style={{
                  borderColor: `${accent.color}24`,
                  background: 'rgba(255,255,255,0.78)',
                }}
              >
                <Search size={12} style={{ color: accent.color }} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models"
                  className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto p-1.5" role="listbox">
              {filteredModels.length ? (
                filteredModels.map((model) => {
                  const selected = model.key === modelKey;
                  const disabled = chosenKeys.includes(model.key) && model.key !== modelKey;
                  return (
                    <button
                      key={model.key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={disabled}
                      onClick={() => chooseModel(model.key)}
                      className="group/model flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45"
                      style={{
                        background: selected ? `${accent.color}14` : 'transparent',
                        color: selected ? accent.color : 'rgba(11,18,32,0.76)',
                      }}
                      onMouseEnter={(event) => {
                        if (!disabled && !selected) event.currentTarget.style.background = 'rgba(22,97,171,0.070)';
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.background = selected ? `${accent.color}14` : 'transparent';
                      }}
                    >
                      <span
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                        style={{
                          background: selected ? `${accent.color}1f` : 'rgba(22,97,171,0.075)',
                          color: selected ? accent.color : 'rgba(11,18,32,0.48)',
                          border: `1px solid ${selected ? `${accent.color}34` : 'rgba(22,97,171,0.10)'}`,
                        }}
                      >
                        {model.display_name?.slice(0, 1) ?? model.key.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold">
                          {model.display_name ?? model.key}
                        </span>
                        <span className="mono mt-0.5 block truncate text-[9px] text-white/30">
                          {disabled ? 'Already selected' : model.key}
                        </span>
                      </span>
                      {selected && <Check size={14} style={{ color: accent.color }} />}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-xs font-medium text-white/30">
                  No matching models
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Remove button */}
      <button
        id={`remove-model-${rowId}`}
        onClick={() => onRemove(rowId)}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 flex-shrink-0"
        aria-label="Remove model"
      >
        <X size={13} />
      </button>
    </div>
  );
}
