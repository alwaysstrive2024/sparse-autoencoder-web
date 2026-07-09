import { useEffect, useState, useRef } from 'react';
import { PIPELINE_STEPS } from '../constants';

/**
 * LoadingOverlay
 * Full-screen overlay that narrates the LLM → XAI pipeline
 * while the backend /analyze request is in flight.
 *
 * Props:
 *   models          {string[]}  — model keys currently being processed
 *   availableModels {object[]}  — from /models endpoint, for display_name lookup
 */
export default function LoadingOverlay({ models, availableModels }) {
  const [logLines, setLogLines] = useState([]);
  const [currentModelIdx, setCurrentModelIdx] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [done, setDone] = useState(false);
  const logRef = useRef(null);

  // Build a flat sequence of steps: for each model → all PIPELINE_STEPS, then a "done" marker.
  const getDisplayName = (key) =>
    availableModels.find((m) => m.key === key)?.display_name ?? key;

  // Advance through pipeline steps at a realistic pace
  useEffect(() => {
    if (!models.length) return;
    setLogLines([]);
    setCurrentModelIdx(0);
    setCurrentStep(0);
    setDone(false);

    let mIdx = 0;
    let sIdx = 0;

    // Add the first model header immediately
    setLogLines([
      {
        type: 'header',
        text: `Model ${mIdx + 1} / ${models.length}: ${getDisplayName(models[mIdx])}`,
        key: models[mIdx],
      },
    ]);

    const interval = setInterval(() => {
      if (mIdx >= models.length) {
        setDone(true);
        clearInterval(interval);
        return;
      }

      const step = PIPELINE_STEPS[sIdx];
      const modelName = getDisplayName(models[mIdx]);

      setLogLines((prev) => [
        ...prev,
        {
          type: 'step',
          icon: step.icon,
          tool: step.tool,
          toolColor: step.toolColor,
          text: step.text(modelName),
          id: `${mIdx}-${sIdx}`,
        },
      ]);

      setCurrentStep(sIdx);
      setCurrentModelIdx(mIdx);

      sIdx++;
      if (sIdx >= PIPELINE_STEPS.length) {
        // Move to next model
        sIdx = 0;
        mIdx++;
        if (mIdx < models.length) {
          setTimeout(() => {
            setLogLines((prev) => [
              ...prev,
              {
                type: 'header',
                text: `Model ${mIdx + 1} / ${models.length}: ${getDisplayName(models[mIdx])}`,
                key: models[mIdx],
              },
            ]);
          }, 120);
        }
      }
    }, 420);

    return () => clearInterval(interval);
  }, [models.join(',')]); // eslint-disable-line

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  const progress =
    models.length === 0
      ? 0
      : Math.min(
          ((currentModelIdx * PIPELINE_STEPS.length + currentStep) /
            (models.length * PIPELINE_STEPS.length)) *
            100,
          95
        );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-md grid-bg"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.94), rgba(231,240,255,0.94)), radial-gradient(circle at 22% 18%, rgba(130,49,142,0.18), transparent 34%)',
        }}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl mx-4 glass-card overflow-hidden shadow-2xl">
        {/* Scan line effect */}
        <div
          className="absolute left-0 right-0 h-px pointer-events-none z-10"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(130,49,142,0.58), rgba(22,97,171,0.48), transparent)',
            animation: 'scanLine 3s linear infinite',
            top: 0,
          }}
        />

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.07] flex items-center gap-3">
          {/* Spinning ring */}
          <div className="relative w-9 h-9 flex-shrink-0">
            <div
              className="absolute inset-0 rounded-full border-2 border-transparent animate-spin-slow"
              style={{
                borderTopColor: '#82318e',
                borderRightColor: '#1661ab',
              }}
            />
            <div
              className="absolute inset-1 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(130,49,142,0.18)' }}
            >
              <span className="text-sm">🔬</span>
            </div>
          </div>

          <div>
            <h2 className="font-bold text-base text-white leading-tight">
              Running Interpretability Pipeline
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              LLM + XAI — Sequential hot-swap mode
            </p>
          </div>

          <div className="ml-auto flex gap-2">
            <span
              className="tag"
              style={{ background: 'rgba(130,49,142,0.17)', color: '#5f1f69', border: '1px solid rgba(130,49,142,0.40)' }}
            >
              LLM
            </span>
            <span
              className="tag"
              style={{ background: 'rgba(22,97,171,0.17)', color: '#0d3f7a', border: '1px solid rgba(22,97,171,0.40)' }}
            >
              XAI
            </span>
          </div>
        </div>

        {/* Model chips */}
        <div className="px-6 pt-4 pb-2 flex gap-2 flex-wrap">
          {models.map((key, i) => (
            <div
              key={key}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background:
                  i === currentModelIdx
                    ? 'rgba(130,49,142,0.18)'
                    : 'rgba(22,97,171,0.090)',
                border:
                  i === currentModelIdx
                    ? '1px solid rgba(130,49,142,0.46)'
                    : '1px solid rgba(22,97,171,0.24)',
                color: i === currentModelIdx ? '#5f1f69' : 'rgba(11,18,32,0.68)',
                transition: 'all 0.3s ease',
              }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${i === currentModelIdx ? 'animate-pulse' : ''}`}
                style={{ background: i === currentModelIdx ? '#82318e' : 'rgba(22,97,171,0.36)' }}
              />
              {availableModels.find((m) => m.key === key)?.display_name ?? key}
            </div>
          ))}
        </div>

        {/* Terminal log */}
        <div
          ref={logRef}
          className="mx-4 mb-4 rounded-xl overflow-y-auto"
          style={{
            height: '240px',
            background: 'rgba(244,249,255,0.94)',
            border: '1px solid rgba(22,97,171,0.28)',
            padding: '12px 14px',
          }}
        >
          {logLines.map((line, idx) => {
            if (line.type === 'header') {
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 mt-3 mb-1 first:mt-0 animate-fade-up"
                >
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">
                    {line.text}
                  </span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
              );
            }
            return (
              <div
                key={line.id}
                className="flex items-start gap-2 py-0.5 animate-fade-up"
                style={{ animationDelay: `${idx * 20}ms` }}
              >
                <span className="text-xs leading-5 select-none">{line.icon}</span>
                <span
                  className="mono text-[10px] font-semibold leading-5 flex-shrink-0"
                  style={{ color: line.toolColor }}
                >
                  [{line.tool}]
                </span>
                <span className="mono text-[10px] text-white/55 leading-5">{line.text}</span>
              </div>
            );
          })}

          {/* Blinking cursor */}
          {!done && (
            <div className="flex items-center gap-1 mt-1">
              <span className="mono text-[10px]" style={{ color: '#82318e' }}>{'>'}</span>
              <span
                className="inline-block w-1.5 h-3 animate-terminal-blink rounded-sm"
                style={{ background: 'rgba(130,49,142,0.72)' }}
              />
            </div>
          )}
          {done && (
            <div className="mono text-[10px] mt-1" style={{ color: '#1661ab' }}>
              ✅ All models processed. Awaiting response…
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-4 pb-5">
          <div className="flex justify-between text-[10px] text-white/35 mb-1.5 mono">
            <span>
              Processing model {Math.min(currentModelIdx + 1, models.length)} of {models.length}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: 'rgba(22,97,171,0.18)' }}
          >
            <div
              className="h-full rounded-full animate-shimmer"
              style={{
                width: `${progress}%`,
                background:
                  'linear-gradient(90deg, #5f1f69, #82318e, #1661ab, #4f46e5, #82318e)',
                backgroundSize: '200% auto',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
