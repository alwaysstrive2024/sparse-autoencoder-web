import { useMemo, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { RotateCcw } from 'lucide-react';

/**
 * ConceptCluster
 * An SVG radial node-link graph showing activated SAE concepts around the prompt.
 *
 * Props:
 *   modelData  — full model data object (report_1_global, model_metadata)
 *   modelColor — color tokens from constants.js
 */
export default function ConceptCluster({ modelData, modelColor }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const concepts = useMemo(() => {
    const raw = modelData?.report_1_global?.fired_features_summary ?? [];
    // Deduplicate by concept_label, keep highest max_activation
    const map = new Map();
    for (const f of raw) {
      const existing = map.get(f.concept_label);
      if (!existing || f.max_activation > existing.max_activation) {
        map.set(f.concept_label, f);
      }
    }
    return [...map.values()]
      .sort((a, b) => b.max_activation - a.max_activation)
      .slice(0, 12);
  }, [modelData]);

  // SVG dimensions
  const W = 300;
  const H = 300;
  const CX = 150;
  const CY = 150;
  const RADIUS = 102;

  const activationScale = useMemo(
    () => {
      const values = concepts.map((c) => Number(c.max_activation ?? 0));
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      return { min, max, spread: Math.max(max - min, 0.001) };
    },
    [concepts]
  );

  const promptText = modelData?.model_metadata?.prompt ?? 'Prompt';
  const shortPrompt =
    promptText.length > 22 ? promptText.slice(0, 20) + '…' : promptText;

  if (!concepts.length) {
    return (
      <div className="flex items-center justify-center h-48 text-white/20 text-sm">
        No concept data
      </div>
    );
  }

  return (
    <div className="relative">
      <TransformWrapper
        initialScale={1}
        minScale={0.5}
        maxScale={4}
        centerOnInit
        wheel={{ step: 0.1 }}
      >
        {({ resetTransform }) => (
          <>
            <button
              onClick={() => resetTransform()}
              className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 
                         border border-white/10 text-white/50 hover:text-white/80 transition-colors
                         backdrop-blur-sm shadow-sm flex items-center justify-center"
              title="Reset Zoom"
            >
              <RotateCcw size={14} />
            </button>
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%', overflow: 'hidden', cursor: 'grab', borderRadius: '12px' }}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                style={{ overflow: 'visible' }}
              >
            <defs>
          {/* Radial glow gradient for center node */}
          <radialGradient id={`cg-${modelColor.accent.replace('#', '')}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={modelColor.accent} stopOpacity="0.4" />
            <stop offset="100%" stopColor={modelColor.accent} stopOpacity="0" />
          </radialGradient>

          {/* Line gradient */}
          <linearGradient id={`lg-${modelColor.accent.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={modelColor.accent} stopOpacity="0.7" />
            <stop offset="100%" stopColor={modelColor.accent} stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Background dashed rings */}
        {[0.35, 0.65, 1.0].map((r, i) => (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={RADIUS * r}
            fill="none"
            stroke="rgba(22,97,171,0.22)"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
        ))}

        {/* Concept nodes + connecting lines */}
        {concepts.map((concept, i) => {
          const angle = (i / concepts.length) * 2 * Math.PI - Math.PI / 2;
          const nx = CX + RADIUS * Math.cos(angle);
          const ny = CY + RADIUS * Math.sin(angle);
          const rankNorm = concepts.length > 1 ? 1 - i / (concepts.length - 1) : 1;
          const activationNorm = (Number(concept.max_activation ?? 0) - activationScale.min) / activationScale.spread;
          const norm = Math.max(0, Math.min(1, activationNorm || rankNorm));
          const nodeR = 4 + Math.pow(norm, 1.25) * 16;
          const isHovered = hoveredIdx === i;

          // Label position: push outward beyond node
          const labelR = RADIUS + nodeR + 16;
          const lx = CX + labelR * Math.cos(angle);
          const ly = CY + labelR * Math.sin(angle);
          const labelAnchor =
            Math.cos(angle) > 0.2 ? 'start' : Math.cos(angle) < -0.2 ? 'end' : 'middle';

          return (
            <g
              key={concept.feature_id}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Connecting line */}
              <line
                x1={CX}
                y1={CY}
                x2={nx}
                y2={ny}
                stroke={modelColor.accent}
                strokeWidth={isHovered ? 2.4 : 0.7 + norm * 2.0}
                strokeOpacity={isHovered ? 0.95 : 0.38 + norm * 0.48}
                style={{ transition: 'stroke-width 0.2s, stroke-opacity 0.2s' }}
              />

              {/* Outer glow ring on high activation */}
              {norm > 0.6 && (
                <circle
                  cx={nx}
                  cy={ny}
                  r={nodeR + 4}
                  fill={modelColor.accent}
                  fillOpacity={0.14}
                  className="animate-pulse-slow"
                />
              )}

              {/* Main node circle */}
              <circle
                cx={nx}
                cy={ny}
                r={isHovered ? nodeR + 2 : nodeR}
                fill={modelColor.accent}
                fillOpacity={isHovered ? 0.84 : 0.24 + norm * 0.58}
                stroke={modelColor.accent}
                strokeWidth={isHovered ? 2 : 1}
                strokeOpacity={isHovered ? 1 : 0.65 + norm * 0.3}
                style={{ transition: 'r 0.2s, fill-opacity 0.2s' }}
              />

              {/* Label */}
              <text
                x={lx}
                y={ly}
                textAnchor={labelAnchor}
                dominantBaseline="middle"
                fill="#172033"
                fillOpacity={isHovered ? 1 : 0.68 + norm * 0.28}
                fontSize={isHovered ? 9.5 : 8.5}
                fontFamily="'Outfit', sans-serif"
                fontWeight={isHovered ? '600' : '400'}
                style={{ transition: 'fill-opacity 0.2s, font-size 0.2s', userSelect: 'none' }}
              >
                {concept.concept_label.length > 16
                  ? concept.concept_label.slice(0, 14) + '…'
                  : concept.concept_label}
              </text>

              {/* Tooltip on hover */}
              {isHovered && (
                <g>
                  <rect
                    x={nx - 52}
                    y={ny - nodeR - 32}
                    width={104}
                    height={26}
                    rx={5}
                    fill="#ffffff"
                    stroke={modelColor.accent}
                    strokeWidth={1}
                    strokeOpacity={0.72}
                  />
                  <text
                    x={nx}
                    y={ny - nodeR - 22}
                    textAnchor="middle"
                    fill="#172033"
                    fillOpacity={1}
                    fontSize={8}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    #{concept.feature_id} · max {concept.max_activation.toFixed(3)}
                  </text>
                  <text
                    x={nx}
                    y={ny - nodeR - 12}
                    textAnchor="middle"
                    fill={modelColor.text}
                    fontSize={8.5}
                    fontFamily="'Outfit', sans-serif"
                  >
                    {concept.concept_label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Center glow halo */}
        <circle
          cx={CX}
          cy={CY}
          r={36}
          fill={`url(#cg-${modelColor.accent.replace('#', '')})`}
        />

        {/* Center node */}
        <circle
          cx={CX}
          cy={CY}
          r={26}
          fill={modelColor.accent}
          fillOpacity={0.22}
          stroke={modelColor.accent}
          strokeWidth={1.5}
          strokeOpacity={0.88}
        />
        <circle cx={CX} cy={CY} r={22} fill={modelColor.accent} fillOpacity={0.14} />

        {/* Center text */}
        <text
          x={CX}
          y={CY - 5}
          textAnchor="middle"
          fill="#172033"
          fillOpacity={1}
          fontSize={8}
          fontFamily="'Outfit', sans-serif"
          fontWeight="700"
          letterSpacing="0.06em"
          textDecoration="none"
        >
          PROMPT
        </text>
        <text
          x={CX}
          y={CY + 6}
          textAnchor="middle"
          fill={modelColor.text}
          fontSize={7.5}
          fontFamily="'Outfit', sans-serif"
        >
              {shortPrompt}
            </text>
          </svg>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>

      {/* Legend */}
      <div className="mt-1 flex flex-col items-center justify-center gap-1 text-[10px] text-white/30">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: modelColor.accent, opacity: 0.35 }} />
            Low activation
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-full" style={{ background: modelColor.accent, opacity: 0.88 }} />
            High activation
          </span>
        </div>
        <span className="text-white/20 italic">Scroll to zoom, drag to pan</span>
      </div>
    </div>
  );
}
