import { useMemo } from 'react';
import { Hash, Flame } from 'lucide-react';

/**
 * FeatureBars
 * Top-K SAE global feature firing bars, drawn from report_1_global.
 * Bars are scaled by max_activation so visual length reflects peak strength.
 *
 * Props:
 *   modelData  — full model data object
 *   modelColor — color tokens from constants.js
 *   topK       — number of top features to display
 */
export default function FeatureBars({ modelData, modelColor, topK }) {
  const featureRows = useMemo(() => {
    const summary = modelData?.report_1_global?.fired_features_summary ?? [];
    return summary.slice(0, topK);
  }, [modelData, topK]);

  // Normalise bar widths against peak activation.
  const globalMaxAct = useMemo(
    () => Math.max(...featureRows.map((f) => f.max_activation), 1),
    [featureRows]
  );

  if (!featureRows.length) {
    return (
      <div className="text-white/20 text-sm text-center py-6">No feature data</div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Column header */}
      <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
        <span className="mono text-[9px] text-white/25 w-12 flex-shrink-0">Feature</span>
        <span className="mono text-[9px] text-white/25 flex-1">Concept · peak activation</span>
        <span className="mono text-[9px] text-white/25 w-12 text-right flex-shrink-0">peak</span>
      </div>

      <div
        className="space-y-2 pr-1 overflow-y-auto overscroll-contain"
        style={{
          maxHeight: '620px',
          scrollbarGutter: 'stable',
        }}
      >
        {featureRows.map((feat, i) => {
          // Bar width and intensity reflect peak activation.
          const pct      = (feat.max_activation / globalMaxAct) * 100;
          const actRatio = feat.max_activation / globalMaxAct;
          const isTop    = i === 0;

          return (
            <div
              key={feat.feature_id}
              className="group flex items-center gap-2 animate-fade-up"
              style={{ animationDelay: `${i * 28}ms` }}
            >
              {/* Feature ID chip */}
              <span
                className="mono text-[9px] font-bold w-12 flex-shrink-0 px-1 py-0.5 rounded-md text-center truncate"
                style={{
                  background: isTop ? modelColor.bg : 'rgba(22,97,171,0.075)',
                  border: `1px solid ${isTop ? modelColor.border : 'rgba(22,97,171,0.22)'}`,
                  color: isTop ? modelColor.text : 'rgba(11,18,32,0.68)',
                }}
                title={`Feature #${feat.feature_id}`}
              >
                #{feat.feature_id}
              </span>

              {/* Bar + label */}
              <div className="flex-1 flex flex-col gap-0.5">
                {/* Concept label */}
                <span
                  className="text-[10px] font-medium leading-none truncate"
                  style={{ color: isTop ? 'rgba(11,18,32,0.94)' : 'rgba(11,18,32,0.76)' }}
                  title={feat.concept_label}
                >
                  {feat.concept_label}
                </span>

                {/* Bar row — width = max activation proportion */}
                <div className="flex items-center gap-1.5">
                  <div
                    className="relative flex-1 h-3 rounded-md overflow-hidden"
                    style={{ background: 'rgba(22,97,171,0.14)' }}
                  >
                    {/* Fill */}
                    <div
                      className="absolute left-0 top-0 h-full rounded-md animate-progress-fill"
                      style={{
                        '--fill-width': `${pct}%`,
                        width: `${pct}%`,
                        background: modelColor.gradientBar,
                        opacity: 0.5 + actRatio * 0.5,
                        backgroundSize: '200% auto',
                      }}
                    />
                    {/* Shimmer on rank-1 */}
                    {isTop && (
                      <div
                        className="absolute inset-0 animate-shimmer opacity-25"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                          backgroundSize: '200% auto',
                        }}
                      />
                    )}
                  </div>

                  {/* Token count (primary sort key) + peak activation */}
                  <span className="mono text-[9px] text-white/50 flex-shrink-0 flex items-center gap-1">
                    <Flame size={8} style={{ color: modelColor.accent }} />
                    {feat.max_activation.toFixed(2)}
                    <span className="text-white/20">avg {feat.avg_activation.toFixed(2)}</span>
                  </span>
                </div>
              </div>

              {/* fired_token_count badge — shown as supporting context */}
              <span
                className="mono text-[9px] w-12 text-right flex-shrink-0 font-bold"
                style={{ color: feat.fired_token_count > 1 ? modelColor.text : 'rgba(11,18,32,0.58)' }}
                title={`Fires on ${feat.fired_token_count} token(s) of this prompt`}
              >
                {feat.fired_token_count}tok
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 pt-1 border-t border-white/[0.05] text-[9px] text-white/20">
        <span className="flex items-center gap-1">
          <Hash size={8} />Feature ID
        </span>
        <span className="flex items-center gap-1">
          <Flame size={8} />peak · avg activation
        </span>
        <span className="ml-auto">Bar length = max activation</span>
      </div>
    </div>
  );
}
