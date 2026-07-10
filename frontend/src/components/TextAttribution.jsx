import { useMemo, useState } from 'react';
import FloatingTooltip from './FloatingTooltip';

/**
 * TextAttribution
 * Renders the input prompt as inline token spans, each highlighted in the
 * model's accent colour with opacity proportional to its peak SAE activation.
 *
 * Props:
 *   modelData  — full model data object
 *   modelColor — colour tokens from constants.js
 */
export default function TextAttribution({ modelData, modelColor }) {
  const [hoveredToken, setHoveredToken] = useState(null);

  const tokenData = useMemo(() => {
    const firings = modelData?.report_2_per_token?.token_level_firings ?? [];
    if (!firings.length) return [];

    // Per-token peak activation (top-1 feature)
    const peaks = firings.map((t) => t.top_50_features?.[0]?.activation ?? 0);
    const maxPeak = Math.max(...peaks, 1e-9);

    // ── Rank-based equal-step gradient ────────────────────────────────────────
    // Sort token indices by peak ascending → assign rank 0…N-1
    // gradNorm = rank / (N-1), so the lowest-firing token is always the
    // lightest colour and the highest-firing is always the darkest, with N
    // evenly-spaced steps regardless of how close raw values are.
    const N = firings.length;
    const sorted = [...peaks]
      .map((p, i) => ({ i, p }))
      .sort((a, b) => a.p - b.p);

    const rankMap = {};
    sorted.forEach(({ i }, rank) => { rankMap[i] = rank; });
    // ──────────────────────────────────────────────────────────────────────────

    return firings.map((t, i) => ({
      token: t.token_string,
      index: t.token_index,
      peak: peaks[i],
      norm: peaks[i] / maxPeak,           // kept for tooltip heat bar (true ratio)
      gradNorm: N <= 1 ? 1.0 : rankMap[i] / (N - 1),  // drives visual colour
      topLabel: t.top_50_features?.[0]?.concept_label ?? '—',
      topFeatId: t.top_50_features?.[0]?.feature_id ?? null,
    }));
  }, [modelData]);

  if (!tokenData.length) {
    return <p className="text-white/20 text-sm">No token data</p>;
  }

  // Hex to rgba helper
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <div>
      {/* Token row */}
      <div
        className="text-[13px] leading-loose font-medium tracking-wide flex flex-wrap gap-y-1"
        aria-label="Token attribution map"
      >
        {tokenData.map((t) => {
          const isHovered = hoveredToken?.token?.index === t.index;
          const alpha = 0.16 + t.gradNorm * 0.68;          // lightest 16% → brightest 84%
          const borderAlpha = 0.28 + t.gradNorm * 0.62;    // rank-based step gradient

          return (
            <span
              key={t.index}
              className="relative inline-flex items-center px-1 py-0.5 rounded-md cursor-default mx-[1px]"
              style={{
                background: hexToRgba(modelColor.accent, isHovered ? Math.min(alpha + 0.2, 0.9) : alpha),
                borderBottom: `2px solid ${hexToRgba(modelColor.accent, isHovered ? 1 : borderAlpha)}`,
                color: t.gradNorm > 0.62 ? 'white' : 'rgba(11,18,32,0.88)',
                fontWeight: t.gradNorm > 0.7 ? '700' : '500',
                transition: 'background 0.15s ease, color 0.15s ease',
                boxShadow: isHovered ? `0 0 12px ${hexToRgba(modelColor.accent, 0.52)}` : 'none',
              }}
              onMouseEnter={(event) => setHoveredToken({ token: t, x: event.clientX, y: event.clientY })}
              onMouseMove={(event) => setHoveredToken({ token: t, x: event.clientX, y: event.clientY })}
              onMouseLeave={() => setHoveredToken(null)}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setHoveredToken({ token: t, x: rect.left + rect.width / 2, y: rect.top });
              }}
              onBlur={() => setHoveredToken(null)}
              tabIndex={0}
            >
              {t.token}
            </span>
          );
        })}
      </div>

      {hoveredToken && (
        <FloatingTooltip x={hoveredToken.x} y={hoveredToken.y} color={modelColor} width={280}>
          <div className="space-y-1">
            <div className="mono text-[12px] font-bold text-slate-800">
              &quot;{hoveredToken.token.token}&quot; · act {hoveredToken.token.peak.toFixed(4)}
            </div>
            <div className="truncate text-[10px] font-semibold" style={{ color: modelColor.text }}>
              {hoveredToken.token.topFeatId != null ? `#${hoveredToken.token.topFeatId}` : '#—'} {hoveredToken.token.topLabel}
            </div>
            <div className="h-1.5 rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${hoveredToken.token.norm * 100}%`,
                  background: modelColor.gradientBar,
                }}
              />
            </div>
          </div>
        </FloatingTooltip>
      )}

      {/* Intensity scale legend */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-white/25">SAE activation intensity:</span>
        <div
          className="flex-1 h-1.5 rounded-full max-w-[120px]"
          style={{
            background: `linear-gradient(90deg, ${hexToRgba(modelColor.accent, 0.22)}, ${modelColor.accent})`,
          }}
        />
        <span className="text-[10px] text-white/25">Low → High</span>
      </div>
    </div>
  );
}
