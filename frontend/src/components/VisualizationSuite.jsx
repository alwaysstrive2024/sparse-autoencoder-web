import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Boxes,
  CircleDot,
  Grid3X3,
  Maximize2,
  Map as MapIcon,
  Network,
  X,
} from 'lucide-react';
import ConceptCluster from './ConceptCluster';
import EChartCanvas from './EChartCanvas';
import FloatingTooltip from './FloatingTooltip';

function hexToRgba(hex, alpha) {
  const safe = typeof hex === 'string' && hex.startsWith('#') ? hex : '#1661ab';
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function truncateLabel(label, limit = 18) {
  if (!label) return 'Concept';
  return label.length > limit ? `${label.slice(0, limit - 1)}...` : label;
}

function deriveVisualizationData(modelData) {
  const features = modelData?.report_1_global?.fired_features_summary ?? [];
  const firings = modelData?.report_2_per_token?.token_level_firings ?? [];
  const tokens = firings.map((t) => ({
    token_index: t.token_index,
    token_string: t.token_string,
  }));
  const topFeatures = features.slice(0, 50);
  const topIds = new Set(topFeatures.map((f) => f.feature_id));
  const cells = [];
  const byFeature = new Map();

  for (const token of firings) {
    for (const feat of token.top_50_features ?? []) {
      if (!topIds.has(feat.feature_id)) continue;
      const cell = {
        token_index: token.token_index,
        feature_id: feat.feature_id,
        activation: feat.activation,
      };
      cells.push(cell);
      if (!byFeature.has(feat.feature_id)) byFeature.set(feat.feature_id, []);
      byFeature.get(feat.feature_id).push(cell);
    }
  }

  const landscape = topFeatures.map((feat, index) => {
    const values = byFeature.get(feat.feature_id) ?? [];
    const peak = values.reduce(
      (best, cell) => (!best || cell.activation > best.activation ? cell : best),
      null
    );
    const peakIndex = peak?.token_index ?? -1;
    return {
      ...feat,
      rank: index + 1,
      peak_token_index: peakIndex,
      peak_token: tokens[peakIndex]?.token_string ?? '',
    };
  });

  return {
    tokens,
    features: topFeatures,
    landscape,
    heatmap: { features: topFeatures.slice(0, 30), cells },
    stream: { series: [], tokens },
    coactivation_graph: { nodes: [], links: [] },
    treemap: topFeatures.slice(0, 30).map((feat) => ({
      ...feat,
      size: Math.max(feat.sum_activation ?? 0, feat.max_activation ?? 0),
    })),
  };
}

export default function VisualizationSuite({ modelData, modelColor }) {
  const [activeView, setActiveView] = useState('graph');
  const visual = useMemo(
    () => modelData?.visualization_data ?? deriveVisualizationData(modelData),
    [modelData]
  );

  const tabs = [
    { id: 'landscape', label: 'Landscape', icon: MapIcon },
    { id: 'heatmap', label: 'Heatmap', icon: Grid3X3 },
    { id: 'stream', label: 'Stream', icon: Activity },
    { id: 'cluster', label: 'Cluster', icon: CircleDot },
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'treemap', label: 'Treemap', icon: Boxes },
  ];

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${modelColor.border}`,
        background: 'rgba(255,255,255,0.78)',
      }}
    >
      <div
        className="flex items-center gap-1 p-1 overflow-x-auto"
        style={{
          background: 'linear-gradient(90deg, rgba(239,245,255,0.96), rgba(255,255,255,0.92))',
          borderBottom: '1px solid rgba(22,97,171,0.16)',
        }}
      >
        {tabs.map(({ id, label, icon: Icon }) => {
          const selected = activeView === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveView(id)}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-colors"
              style={{
                color: selected ? modelColor.text : 'rgba(11,18,32,0.58)',
                background: selected ? modelColor.bg : 'transparent',
                border: `1px solid ${selected ? modelColor.border : 'transparent'}`,
              }}
              title={label}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="h-[360px] overflow-hidden">
        {activeView === 'landscape' && (
          <ConceptLandscape visual={visual} modelColor={modelColor} />
        )}
        {activeView === 'heatmap' && (
          <FeatureHeatmap visual={visual} modelColor={modelColor} />
        )}
        {activeView === 'stream' && (
          <ActivationStream visual={visual} modelColor={modelColor} />
        )}
        {activeView === 'cluster' && (
          <ClusterViewer modelData={modelData} modelColor={modelColor} />
        )}
        {activeView === 'graph' && (
          <CoactivationGraph visual={visual} modelColor={modelColor} />
        )}
        {activeView === 'treemap' && (
          <FeatureTreemap visual={visual} modelColor={modelColor} />
        )}
      </div>
    </div>
  );
}

function ChartFrame({ children, title, modelColor, modalContent }) {
  const [soloOpen, setSoloOpen] = useState(false);
  const webCanvasStyle = { width: 'min(1260px, 100%)' };

  return (
    <div className="w-full h-full p-3">
      <div
        className="group relative w-full h-full rounded-lg bg-white/70 border border-white/[0.08] overflow-auto"
        role="button"
        tabIndex={0}
        onDoubleClick={() => setSoloOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setSoloOpen(true);
        }}
      >
        <button
          type="button"
          onClick={() => setSoloOpen(true)}
          className="absolute top-2 right-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md border opacity-90 transition-opacity group-hover:opacity-100"
          style={{
            background: 'rgba(255,255,255,0.90)',
            borderColor: 'rgba(22,97,171,0.22)',
            color: modelColor.text,
            boxShadow: '0 8px 20px rgba(22,97,171,0.12)',
          }}
          title="Open image view"
        >
          <Maximize2 size={14} />
        </button>
        <div className="w-full h-full min-w-[560px]">{children}</div>
      </div>
      {soloOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-5"
          style={{
            background: 'rgba(11,18,32,0.42)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSoloOpen(false);
          }}
        >
          <div
            className="flex h-[88vh] w-[92vw] max-w-[1500px] flex-col rounded-xl border bg-white/92 shadow-2xl overflow-hidden"
            style={{
              borderColor: 'rgba(255,255,255,0.62)',
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 border-b"
              style={{ borderColor: 'rgba(22,97,171,0.16)', background: 'rgba(239,245,255,0.72)' }}
            >
              <span className="text-sm font-bold" style={{ color: modelColor.text }}>
                {title}
              </span>
              <span className="mono text-[10px] text-white/35">scroll to browse</span>
              <button
                type="button"
                onClick={() => setSoloOpen(false)}
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border"
                style={{
                  background: 'rgba(255,255,255,0.88)',
                  borderColor: 'rgba(22,97,171,0.22)',
                  color: modelColor.text,
                }}
                title="Close image view"
              >
                <X size={15} />
              </button>
            </div>
            <div className="relative flex-1 overflow-auto p-5">
              <div className="mx-auto min-h-full" style={webCanvasStyle}>
                {modalContent ?? children}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ClusterViewer({ modelData, modelColor }) {
  const [soloOpen, setSoloOpen] = useState(false);

  return (
    <div className="relative h-full p-3">
      <button
        type="button"
        onClick={() => setSoloOpen(true)}
        className="absolute top-5 left-5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border"
        style={{
          background: 'rgba(255,255,255,0.88)',
          borderColor: 'rgba(22,97,171,0.22)',
          color: modelColor.text,
        }}
        title="Open image view"
      >
        <Maximize2 size={13} />
      </button>
      <div className="h-full rounded-lg bg-white/70 border border-white/[0.08] overflow-hidden">
        <ConceptCluster modelData={modelData} modelColor={modelColor} />
      </div>
      {soloOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-5"
          style={{
            background: 'rgba(11,18,32,0.42)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSoloOpen(false);
          }}
        >
          <div
            className="flex h-[88vh] w-[92vw] max-w-[1500px] flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{
              borderColor: 'rgba(255,255,255,0.62)',
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 border-b"
              style={{ borderColor: 'rgba(22,97,171,0.16)', background: 'rgba(239,245,255,0.72)' }}
            >
              <span className="text-sm font-bold" style={{ color: modelColor.text }}>
                Concept Cluster
              </span>
              <span className="mono text-[10px] text-white/35">scroll to browse</span>
              <button
                type="button"
                onClick={() => setSoloOpen(false)}
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border"
                style={{
                  background: 'rgba(255,255,255,0.88)',
                  borderColor: 'rgba(22,97,171,0.22)',
                  color: modelColor.text,
                }}
                title="Close image view"
              >
                <X size={15} />
              </button>
            </div>
            <div className="relative flex-1 overflow-auto p-5">
              <div className="mx-auto w-full max-w-[1260px]">
                <ClusterConceptBrowser modelData={modelData} modelColor={modelColor} />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ClusterConceptBrowser({ modelData, modelColor }) {
  const concepts = useMemo(() => {
    const raw = modelData?.report_1_global?.fired_features_summary ?? [];
    const map = new Map();
    for (const feature of raw) {
      const key = feature.concept_label ?? feature.feature_id;
      const existing = map.get(key);
      if (!existing || feature.max_activation > existing.max_activation) {
        map.set(key, feature);
      }
    }
    return [...map.values()]
      .sort((a, b) => (b.max_activation ?? 0) - (a.max_activation ?? 0))
      .slice(0, 36);
  }, [modelData]);

  const maxAct = Math.max(...concepts.map((c) => c.max_activation ?? 0), 1);
  const maxCoverage = Math.max(...concepts.map((c) => c.fired_token_count ?? 0), 1);

  if (!concepts.length) {
    return <EmptyVisual message="No concept data" />;
  }

  return (
    <div className="min-h-[calc(88vh-150px)] rounded-lg bg-white/75 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Concept cluster browser
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            {concepts.length} strongest deduplicated concepts
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          activation ranked
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {concepts.map((concept, index) => {
          const activationRatio = (concept.max_activation ?? 0) / maxAct;
          const coverageRatio = (concept.fired_token_count ?? 0) / maxCoverage;
          return (
            <div
              key={`${concept.feature_id}-${concept.concept_label}`}
              className="rounded-lg border p-3"
              style={{
                borderColor: hexToRgba(modelColor.accent, 0.15 + activationRatio * 0.28),
                background: `linear-gradient(135deg, ${hexToRgba(modelColor.accent, 0.08 + activationRatio * 0.18)}, rgba(255,255,255,0.90))`,
              }}
              title={`#${concept.feature_id} ${concept.concept_label}\nmax ${Number(concept.max_activation).toFixed(3)} · ${concept.fired_token_count} tokens`}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mono flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[8px] font-bold"
                  style={{ background: hexToRgba(modelColor.accent, 0.13), color: modelColor.text }}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[10px] font-semibold leading-snug text-slate-800">
                    {truncateLabel(concept.concept_label, 48)}
                  </div>
                  <div className="mono mt-1 text-[8px] text-white/35">
                    #{concept.feature_id} · max {Number(concept.max_activation ?? 0).toFixed(3)}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(coverageRatio * 100, 7)}%`,
                    background: hexToRgba(modelColor.accent, 0.62),
                  }}
                />
              </div>
              <div className="mt-1 text-[8px] text-white/35">
                {concept.fired_token_count ?? 0} fired token{(concept.fired_token_count ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConceptLandscape({ visual, modelColor }) {
  const data = (visual?.landscape ?? []).slice(0, 60);
  const tokens = visual?.tokens ?? [];

  if (!data.length) {
    return <EmptyVisual message="No concept data" />;
  }

  return (
    <ChartFrame
      title="Concept activation landscape"
      modelColor={modelColor}
      modalContent={
        <ConceptLandscapePanel
          data={data}
          tokens={tokens}
          modelColor={modelColor}
          expanded
        />
      }
    >
      <ConceptLandscapePanel data={data} tokens={tokens} modelColor={modelColor} />
    </ChartFrame>
  );
}

function ConceptLandscapePanel({ data, tokens, modelColor, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[560px]' : 'min-h-[300px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Concept activation landscape
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            scatter · dot size = coverage · hover concepts · scroll to zoom
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          {data.length} concepts
        </span>
      </div>
      <LandscapeScatterChart data={data} tokens={tokens} modelColor={modelColor} expanded={expanded} />
    </div>
  );
}

function LandscapeScatterChart({ data, tokens, modelColor, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const tokenLabels = tokens.length
      ? tokens.map((token) => token.token_string)
      : data.map((item, index) => item.peak_token || `#${index + 1}`);
    const maxCoverage = Math.max(...data.map((item) => item.fired_token_count ?? 0), 1);
    const maxAct = Math.max(...data.map((item) => item.max_activation ?? 0), 1);
    const labelStep = Math.max(1, Math.ceil(tokenLabels.length / (compact ? 7 : 16)));
    const points = data.map((item, index) => {
      const fallbackIndex = tokenLabels.length ? index % tokenLabels.length : index;
      const tokenIndex = item.peak_token_index >= 0 ? item.peak_token_index : fallbackIndex;
      return {
        name: truncateLabel(item.concept_label, 28),
        value: [
          Math.max(0, Math.min(tokenIndex, Math.max(tokenLabels.length - 1, 0))),
          item.max_activation ?? 0,
          item.fired_token_count ?? 0,
          item.feature_id,
          item.concept_label,
          item.peak_token || tokenLabels[tokenIndex] || '',
          item.rank ?? index + 1,
        ],
        itemStyle: {
          color: hexToRgba(modelColor.accent, 0.24 + ((item.max_activation ?? 0) / maxAct) * 0.26),
          borderColor: hexToRgba(modelColor.accent, 0.42),
          borderWidth: 1,
        },
      };
    });

    return {
      animation: false,
      grid: {
        left: compact ? 40 : 54,
        right: compact ? 16 : 28,
        top: compact ? 18 : 22,
        bottom: compact ? 46 : 74,
        containLabel: true,
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(22,97,171,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          const value = params.value ?? [];
          return `<div style="font-weight:700;margin-bottom:4px;">${value[4] ?? params.name}</div>
            <div>feature #${value[3] ?? ''}</div>
            <div>peak token: <b>${value[5] ?? ''}</b></div>
            <div>max activation: <b>${Number(value[1] ?? 0).toFixed(4)}</b></div>
            <div>coverage: <b>${value[2] ?? 0}</b> tokens</div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: tokenLabels,
        boundaryGap: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(22,97,171,0.16)' } },
        axisLabel: {
          color: 'rgba(11,18,32,0.50)',
          fontSize: compact ? 9 : 11,
          interval: (index) => index % labelStep === 0 || index === tokenLabels.length - 1,
          hideOverlap: true,
          margin: 12,
          formatter: (value) => truncateLabel(value, compact ? 8 : 15),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: compact ? 3 : 5,
        axisLabel: {
          color: 'rgba(11,18,32,0.42)',
          fontSize: 9,
          formatter: (value) => Number(value).toFixed(value >= 10 ? 0 : 1),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(22,97,171,0.10)', type: 'dashed' } },
      },
      dataZoom: [
        {
          type: 'inside',
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseWheel: true,
          moveOnMouseMove: true,
          throttle: 80,
        },
        {
          type: 'slider',
          height: compact ? 16 : 24,
          bottom: compact ? 8 : 18,
          borderColor: 'rgba(22,97,171,0.10)',
          fillerColor: hexToRgba(modelColor.accent, 0.12),
          handleStyle: { color: modelColor.accent, borderColor: modelColor.accent },
          textStyle: { color: 'rgba(11,18,32,0.40)', fontSize: 9 },
          showDetail: !compact,
          showDataShadow: false,
        },
      ],
      series: [
        {
          name: 'Concepts',
          type: 'scatter',
          data: points,
          symbolSize: (value) => {
            const coverageRatio = Math.sqrt((value?.[2] ?? 0) / maxCoverage);
            return (compact ? 5 : 7) + coverageRatio * (compact ? 9 : 16);
          },
          emphasis: {
            focus: 'self',
            scale: true,
            itemStyle: {
              color: hexToRgba(modelColor.accent, 0.72),
              borderColor: modelColor.accent,
              borderWidth: 2,
            },
          },
          label: {
            show: expanded,
            position: 'right',
            distance: 4,
            color: 'rgba(11,18,32,0.56)',
            fontSize: 9,
            formatter: (params) => Number(params.value?.[6] ?? 99) <= 10 ? truncateLabel(params.value?.[4], 12) : '',
          },
        },
      ],
    };
  }, [data, expanded, modelColor, tokens]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(22,97,171,0.10)' }}
      loadingLabel="Loading landscape"
    />
  );
}

function FeatureHeatmap({ visual, modelColor }) {
  const features = (visual?.heatmap?.features ?? []).slice(0, 32);
  const tokens = visual?.tokens ?? [];
  const featureIds = new Set(features.map((f) => f.feature_id));
  const cells = (visual?.heatmap?.cells ?? []).filter((c) => featureIds.has(c.feature_id));

  if (!features.length || !tokens.length) {
    return <EmptyVisual message="No heatmap data" />;
  }

  return (
    <ChartFrame
      title="Token-feature activation matrix"
      modelColor={modelColor}
      modalContent={
        <FeatureHeatmapPanel
          features={features}
          tokens={tokens}
          cells={cells}
          modelColor={modelColor}
          expanded
        />
      }
    >
      <FeatureHeatmapPanel
        features={features.slice(0, 24)}
        tokens={tokens}
        cells={cells}
        modelColor={modelColor}
      />
    </ChartFrame>
  );
}

function FeatureHeatmapPanel({ features, tokens, cells, modelColor, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[600px]' : 'min-h-[300px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Token-feature activation matrix
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            quantile-scaled heatmap · click cells · scroll to browse
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          {features.length} × {tokens.length}
        </span>
      </div>
      <FeatureHeatmapGrid
        features={features}
        tokens={tokens}
        cells={cells}
        modelColor={modelColor}
        expanded={expanded}
      />
    </div>
  );
}

function FeatureHeatmapGrid({ features, tokens, cells, modelColor, expanded = false }) {
  const [hoveredCell, setHoveredCell] = useState(null);
  const { cellMap, rowStats, sortedValues } = useMemo(() => {
    const cellMap = new Map(cells.map((cell) => [`${cell.feature_id}:${cell.token_index}`, cell.activation ?? 0]));
    const rowStats = new Map();
    const sortedValues = [];

    for (const feature of features) {
      const values = tokens
        .map((token) => cellMap.get(`${feature.feature_id}:${token.token_index}`) ?? 0)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      sortedValues.push(...values);
      const p95 = values[Math.max(Math.ceil(values.length * 0.95) - 1, 0)] ?? 1;
      rowStats.set(feature.feature_id, {
        scaleMax: Math.max(p95, 0.001),
      });
    }
    sortedValues.sort((a, b) => a - b);
    return { cellMap, rowStats, sortedValues };
  }, [cells, features, tokens]);

  const hoveredFeature = hoveredCell ? features[hoveredCell.row] : null;
  const hoveredToken = hoveredCell ? tokens[hoveredCell.col] : null;
  const hoveredActivation = hoveredFeature && hoveredToken
    ? cellMap.get(`${hoveredFeature.feature_id}:${hoveredToken.token_index}`) ?? 0
    : 0;

  const getCellRatio = (feature, activation) => {
    if (activation <= 0) return 0;
    const stats = rowStats.get(feature.feature_id);
    if (!stats) return 0;
    const rowRatio = Math.min(activation / stats.scaleMax, 1);
    let low = 0;
    let high = sortedValues.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (sortedValues[mid] <= activation) low = mid + 1;
      else high = mid;
    }
    const quantileRatio = sortedValues.length ? low / sortedValues.length : rowRatio;
    const blended = rowRatio * 0.48 + quantileRatio * 0.52;
    return Math.max(0.10, Math.min(Math.pow(blended, 0.78), 1));
  };

  return (
    <div className="min-h-0 flex-1 rounded-lg border bg-white/80 p-3" style={{ borderColor: 'rgba(22,97,171,0.10)' }}>
      <div
        className="grid h-full min-h-0 gap-1 overflow-auto pr-1"
        style={{
          gridTemplateColumns: `minmax(${expanded ? 164 : 118}px, 1.15fr) repeat(${tokens.length}, minmax(${expanded ? 74 : 48}px, 0.76fr))`,
          gridAutoRows: expanded ? 'minmax(32px, auto)' : 'minmax(26px, auto)',
        }}
      >
        <div className="sticky left-0 top-0 z-20 rounded-md bg-white/95 px-2 py-2 text-[9px] font-bold uppercase tracking-wide text-white/35">
          feature
        </div>
        {tokens.map((token) => (
          <div
            key={token.token_index}
            className="sticky top-0 z-10 truncate rounded-md bg-white/90 px-1.5 py-2 text-center text-[8px] font-bold text-white/40"
            title={token.token_string}
          >
            {truncateLabel(token.token_string, expanded ? 10 : 6)}
          </div>
        ))}

        {features.map((feature, row) => (
          <div key={feature.feature_id} className="contents">
            <div
              className="sticky left-0 z-10 flex items-center rounded-md px-2 py-1.5 text-[9px] font-semibold"
              style={{
                background: row % 2 ? 'rgba(239,245,255,0.94)' : 'rgba(255,255,255,0.96)',
                color: 'rgba(11,18,32,0.68)',
              }}
              title={`#${feature.feature_id} ${feature.concept_label}`}
            >
              <span className="truncate">{truncateLabel(feature.concept_label, expanded ? 28 : 18)}</span>
            </div>
            {tokens.map((token, col) => {
              const activation = cellMap.get(`${feature.feature_id}:${token.token_index}`) ?? 0;
              const ratio = getCellRatio(feature, activation);
              const hovered = hoveredCell?.row === row && hoveredCell?.col === col;
              return (
                <button
                  key={`${feature.feature_id}:${token.token_index}`}
                  type="button"
                  onMouseEnter={(event) => setHoveredCell({ row, col, x: event.clientX, y: event.clientY })}
                  onMouseMove={(event) => setHoveredCell({ row, col, x: event.clientX, y: event.clientY })}
                  onMouseLeave={() => setHoveredCell(null)}
                  onFocus={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHoveredCell({ row, col, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                  }}
                  onBlur={() => setHoveredCell(null)}
                  className="rounded-md border px-1.5 py-1 text-left transition-transform hover:scale-[1.03]"
                  style={{
                    background: activation > 0
                      ? `linear-gradient(135deg, ${hexToRgba(modelColor.accent, 0.06 + ratio * 0.62)}, ${hexToRgba(modelColor.accent, 0.03 + ratio * 0.22)} 58%, rgba(255,255,255,0.90))`
                      : 'rgba(226,232,240,0.26)',
                    borderColor: hovered
                      ? modelColor.accent
                      : activation > 0
                        ? hexToRgba(modelColor.accent, 0.12 + ratio * 0.34)
                        : 'rgba(148,163,184,0.14)',
                    boxShadow: hovered ? `0 0 0 2px ${hexToRgba(modelColor.accent, 0.14)}` : 'none',
                  }}
                >
                  <div
                    className="mono truncate text-[8px] font-bold"
                    style={{ color: activation > 0 ? modelColor.text : 'rgba(11,18,32,0.30)' }}
                  >
                    {activation > 0 ? activation.toFixed(2) : '0.00'}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {hoveredCell && hoveredFeature && hoveredToken && (
        <FloatingTooltip x={hoveredCell.x} y={hoveredCell.y} color={modelColor} width={300}>
          <div className="space-y-1.5">
            <div className="truncate text-[12px] font-bold text-slate-800">
              {hoveredFeature.concept_label}
            </div>
            <div className="mono truncate text-[9px] text-slate-500">
              token: {hoveredToken.token_string}
            </div>
            <div className="grid grid-cols-2 gap-1 text-center">
              <div className="rounded-md border px-2 py-1" style={{ background: hexToRgba(modelColor.accent, 0.08), borderColor: hexToRgba(modelColor.accent, 0.12) }}>
                <div className="mono text-[10px] font-bold" style={{ color: modelColor.text }}>#{hoveredFeature.feature_id}</div>
                <div className="text-[7px] uppercase tracking-wide text-slate-400">feature</div>
              </div>
              <div className="rounded-md border px-2 py-1" style={{ background: hexToRgba(modelColor.accent, 0.08), borderColor: hexToRgba(modelColor.accent, 0.12) }}>
                <div className="mono text-[10px] font-bold" style={{ color: modelColor.text }}>{hoveredActivation.toFixed(4)}</div>
                <div className="text-[7px] uppercase tracking-wide text-slate-400">activation</div>
              </div>
            </div>
          </div>
        </FloatingTooltip>
      )}
    </div>
  );
}

function ActivationStream({ visual, modelColor }) {
  const fallbackSeries = useMemo(() => {
    if (visual?.stream?.series?.length) return visual.stream.series.slice(0, 8);
    const features = (visual?.features ?? []).slice(0, 8);
    const tokens = visual?.tokens ?? [];
    const cells = visual?.heatmap?.cells ?? [];
    return features.map((feat) => {
      const values = Array(tokens.length).fill(0);
      for (const cell of cells) {
        if (cell.feature_id === feat.feature_id && cell.token_index < values.length) {
          values[cell.token_index] = cell.activation;
        }
      }
      return { ...feat, values };
    });
  }, [visual]);

  const series = fallbackSeries;
  const tokens = visual?.tokens ?? [];
  const palette = [
    modelColor.accent,
    '#1661ab',
    '#82318e',
    '#0f766e',
    '#b45309',
    '#4f46e5',
    '#be123c',
    '#2563eb',
  ];

  if (!series.length || !tokens.length) {
    return <EmptyVisual message="No stream data" />;
  }

  return (
    <ChartFrame
      title="Activation stream"
      modelColor={modelColor}
      modalContent={
        <ActivationStreamPanel
          series={series}
          tokens={tokens}
          palette={palette}
          modelColor={modelColor}
          expanded
        />
      }
    >
      <ActivationStreamPanel
        series={series}
        tokens={tokens}
        palette={palette}
        modelColor={modelColor}
      />
    </ChartFrame>
  );
}

function ActivationStreamPanel({ series, tokens, palette, modelColor, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[560px]' : 'min-h-[300px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Activation stream
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            line chart · hover token positions · drag/scroll to zoom
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          {series.length} concepts
        </span>
      </div>
      <ActivationLineChart
        series={series}
        tokens={tokens}
        palette={palette}
        modelColor={modelColor}
        expanded={expanded}
      />
    </div>
  );
}

function ActivationLineChart({ series, tokens, palette, modelColor, expanded = false }) {
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [chartReady, setChartReady] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!chartRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
      chartInstanceRef.current?.resize();
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!chartRef.current) return undefined;
    let cancelled = false;
    let chart = null;

    Promise.all([
      import('echarts/core'),
      import('echarts/components'),
      import('echarts/charts'),
      import('echarts/renderers'),
    ]).then(([echartsCore, components, charts, renderers]) => {
      if (cancelled || !chartRef.current) return;
      echartsCore.use([
        components.GridComponent,
        components.LegendComponent,
        components.TooltipComponent,
        components.DataZoomComponent,
        charts.LineChart,
        renderers.CanvasRenderer,
      ]);
      chart = echartsCore.init(chartRef.current, null, { renderer: 'canvas' });
      chartInstanceRef.current = chart;
      setChartReady((value) => value + 1);
    });

    return () => {
      cancelled = true;
      chart?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const width = containerSize.width || chartRef.current?.clientWidth || 720;
    const height = containerSize.height || chartRef.current?.clientHeight || 300;
    const compact = !expanded && (width < 760 || height < 340);
    const tokenLabels = tokens.map((token) => token.token_string);
    const labelStep = Math.max(1, Math.ceil(tokenLabels.length / (compact ? 6 : 14)));
    const visibleSeries = compact ? series.slice(0, 6) : series.slice(0, expanded ? 12 : 10);

    chart.setOption({
      color: palette,
      animation: false,
      grid: {
        left: compact ? 34 : 42,
        right: compact ? 12 : 22,
        top: compact ? 52 : 60,
        bottom: compact ? 46 : expanded ? 78 : 68,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(22,97,171,0.18)',
        borderWidth: 1,
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        axisPointer: {
          type: 'line',
          lineStyle: { color: hexToRgba(modelColor.accent, 0.36), width: 1 },
        },
        formatter: (params) => {
          const rows = params
            .filter((item) => Number(item.value) > 0)
            .sort((a, b) => Number(b.value) - Number(a.value))
            .slice(0, 8)
            .map((item) => {
              const value = Number(item.value).toFixed(4);
              return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${item.color};"></span>
                <span style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.seriesName}</span>
                <b style="margin-left:auto;">${value}</b>
              </div>`;
            })
            .join('');
          return `<div style="font-weight:700;margin-bottom:4px;">Token: ${params[0]?.axisValue ?? ''}</div>${rows || '<span style="color:rgba(11,18,32,0.48)">No active feature</span>'}`;
        },
      },
      legend: {
        type: 'scroll',
        top: 0,
        left: 0,
        right: 0,
        itemWidth: 9,
        itemHeight: 9,
        pageButtonItemGap: 4,
        pageIconSize: 9,
        textStyle: {
          color: 'rgba(11,18,32,0.62)',
          fontSize: compact ? 9 : 10,
          width: compact ? 72 : expanded ? 140 : 110,
          overflow: 'truncate',
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: tokenLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(22,97,171,0.16)' } },
        axisLabel: {
          color: 'rgba(11,18,32,0.50)',
          fontSize: compact ? 9 : expanded ? 11 : 10,
          interval: (index) => expanded ? index % Math.max(1, Math.floor(labelStep / 2)) === 0 || index === tokenLabels.length - 1 : index % labelStep === 0 || index === tokenLabels.length - 1,
          hideOverlap: true,
          margin: 12,
          formatter: (value) => truncateLabel(value, compact ? 8 : 14),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: compact ? 3 : 4,
        axisLabel: {
          color: 'rgba(11,18,32,0.42)',
          fontSize: 9,
          formatter: (value) => Number(value).toFixed(value >= 10 ? 0 : 1),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(22,97,171,0.10)', type: 'dashed' } },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseWheel: true,
          moveOnMouseMove: true,
          throttle: 80,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          height: compact ? 16 : expanded ? 24 : 20,
          bottom: compact ? 8 : expanded ? 22 : 18,
          borderColor: 'rgba(22,97,171,0.10)',
          fillerColor: hexToRgba(modelColor.accent, 0.12),
          handleStyle: { color: modelColor.accent, borderColor: modelColor.accent },
          textStyle: { color: 'rgba(11,18,32,0.40)', fontSize: 9 },
          showDetail: !compact,
          showDataShadow: false,
        },
      ],
      series: visibleSeries.map((item, index) => ({
        name: truncateLabel(item.concept_label, compact ? 16 : 24),
        type: 'line',
        data: item.values ?? [],
        smooth: 0.24,
        showSymbol: expanded || (!compact && tokens.length <= 32),
        symbolSize: expanded ? 6 : 5,
        connectNulls: true,
        lineStyle: {
          width: compact ? 2 : expanded ? 2.8 : 2.4,
          opacity: 0.88,
        },
        emphasis: {
          focus: 'series',
          lineStyle: { width: 3.5 },
        },
        endLabel: {
          show: expanded && tokens.length <= 24,
          formatter: () => truncateLabel(item.concept_label, 12),
          color: palette[index % palette.length],
          fontSize: 9,
        },
      })),
    }, true);
  }, [chartReady, containerSize, expanded, modelColor, palette, series, tokens]);

  return (
    <div
      ref={chartRef}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(22,97,171,0.10)' }}
    />
  );
}

function CoactivationGraph({ visual, modelColor }) {
  const nodes = (visual?.coactivation_graph?.nodes ?? []).slice(0, 36);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (visual?.coactivation_graph?.links ?? []).filter(
    (link) => nodeIds.has(link.source) && nodeIds.has(link.target)
  );

  if (!nodes.length) {
    return <EmptyVisual message="No coactivation data" />;
  }

  return (
    <ChartFrame
      title="Co-activation graph"
      modelColor={modelColor}
      modalContent={
        <CoactivationGraphPanel
          nodes={nodes}
          links={links}
          modelColor={modelColor}
          expanded
        />
      }
    >
      <CoactivationGraphPanel
        nodes={nodes.slice(0, 28)}
        links={links}
        modelColor={modelColor}
      />
    </ChartFrame>
  );
}

function CoactivationGraphPanel({ nodes, links, modelColor, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[620px]' : 'min-h-[300px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Co-activation graph
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            force graph · drag nodes · scroll to zoom · hover relationships
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          {nodes.length} nodes · {links.length} links
        </span>
      </div>
      <CoactivationGraphChart nodes={nodes} links={links} modelColor={modelColor} expanded={expanded} />
    </div>
  );
}

function CoactivationGraphChart({ nodes, links, modelColor, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const scopedLinks = links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
    const activationValues = nodes.map((node) => Number(node.max_activation ?? 0));
    const minAct = activationValues.length ? Math.min(...activationValues) : 0;
    const maxAct = activationValues.length ? Math.max(...activationValues) : 1;
    const actSpread = Math.max(maxAct - minAct, 0.001);
    const maxLink = Math.max(...scopedLinks.map((link) => link.strength ?? link.count ?? 0), 1);
    const graphNodes = nodes.map((node, index) => {
      const rankRatio = nodes.length > 1 ? 1 - index / (nodes.length - 1) : 1;
      const activationRatio = Math.max(0, Math.min(1, ((Number(node.max_activation ?? 0) - minAct) / actSpread) || rankRatio));
      const nodeSize = (compact ? 8 : 12) + Math.pow(activationRatio, 0.82) * (compact ? 34 : 46);
      return {
        id: String(node.id),
        name: truncateLabel(node.label, compact ? 18 : 28),
        value: node.max_activation ?? 0,
        feature_id: node.id,
        rawLabel: node.label,
        symbolSize: nodeSize,
        itemStyle: {
          color: hexToRgba(modelColor.accent, 0.26 + activationRatio * 0.46),
          borderColor: hexToRgba(modelColor.accent, 0.68),
          borderWidth: activationRatio > 0.72 ? 2 : 1,
        },
        label: {
          show: expanded ? index < 16 : index < 8,
        },
      };
    });
    const graphLinks = scopedLinks.map((link) => {
      const value = link.strength ?? link.count ?? 0;
      const ratio = value / maxLink;
      return {
        source: String(link.source),
        target: String(link.target),
        value,
        lineStyle: {
          width: 0.6 + Math.pow(ratio, 0.8) * (compact ? 4.6 : 7),
          color: hexToRgba(modelColor.accent, 0.10 + ratio * 0.42),
          curveness: 0.08,
        },
      };
    });

    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(22,97,171,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          if (params.dataType === 'edge') {
            return `<div style="font-weight:700;margin-bottom:4px;">Co-activation</div>
              <div>${params.data.source} → ${params.data.target}</div>
              <div>strength: <b>${Number(params.data.value ?? 0).toFixed(3)}</b></div>`;
          }
          return `<div style="font-weight:700;margin-bottom:4px;">${params.data.rawLabel ?? params.name}</div>
            <div>feature #${params.data.feature_id ?? ''}</div>
            <div>max activation: <b>${Number(params.data.value ?? 0).toFixed(4)}</b></div>`;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          data: graphNodes,
          links: graphLinks,
          roam: true,
          draggable: true,
          focusNodeAdjacency: true,
          force: {
            repulsion: compact ? 130 : 210,
            edgeLength: compact ? [32, 92] : [48, 150],
            gravity: 0.08,
            friction: 0.62,
          },
          lineStyle: {
            opacity: 0.68,
          },
          label: {
            color: 'rgba(11,18,32,0.62)',
            fontSize: compact ? 8 : 10,
            position: 'right',
            formatter: '{b}',
          },
          emphasis: {
            focus: 'adjacency',
            label: { show: true },
            lineStyle: { opacity: 0.92 },
          },
        },
      ],
    };
  }, [expanded, links, modelColor, nodes]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(22,97,171,0.10)' }}
      loadingLabel="Loading graph"
    />
  );
}

function FeatureTreemap({ visual, modelColor }) {
  const items = (visual?.treemap ?? []).slice(0, 36);

  if (!items.length) {
    return <EmptyVisual message="No treemap data" />;
  }

  return (
    <ChartFrame
      title="Feature coverage treemap"
      modelColor={modelColor}
      modalContent={<FeatureTreemapPanel items={items} modelColor={modelColor} expanded />}
    >
      <FeatureTreemapPanel items={items.slice(0, 28)} modelColor={modelColor} />
    </ChartFrame>
  );
}

function FeatureTreemapPanel({ items, modelColor, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[600px]' : 'min-h-[300px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold" style={{ color: modelColor.text }}>
            Feature coverage treemap
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            treemap · click to focus · hover for coverage and activation
          </div>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{ background: hexToRgba(modelColor.accent, 0.10), color: modelColor.text }}
        >
          {items.length} concepts
        </span>
      </div>
      <FeatureTreemapChart items={items} modelColor={modelColor} expanded={expanded} />
    </div>
  );
}

function FeatureTreemapChart({ items, modelColor, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const maxAct = Math.max(...items.map((item) => item.max_activation ?? 0), 1);
    const data = items.map((item) => {
      const activationRatio = (item.max_activation ?? 0) / maxAct;
      const value = Math.max(item.size ?? 0, item.fired_token_count ?? 0, item.max_activation ?? 0, 0.001);
      return {
        name: truncateLabel(item.concept_label, compact ? 16 : 28),
        value,
        feature_id: item.feature_id,
        rawLabel: item.concept_label,
        fired_token_count: item.fired_token_count ?? 0,
        max_activation: item.max_activation ?? 0,
        itemStyle: {
          color: hexToRgba(modelColor.accent, 0.18 + activationRatio * 0.50),
          borderColor: 'rgba(255,255,255,0.88)',
          borderWidth: 2,
          gapWidth: 2,
        },
      };
    });

    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(22,97,171,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          const item = params.data ?? {};
          return `<div style="font-weight:700;margin-bottom:4px;">${item.rawLabel ?? params.name}</div>
            <div>feature #${item.feature_id ?? ''}</div>
            <div>coverage: <b>${item.fired_token_count ?? 0}</b> tokens</div>
            <div>max activation: <b>${Number(item.max_activation ?? 0).toFixed(4)}</b></div>`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: true,
          nodeClick: 'zoomToNode',
          breadcrumb: {
            show: expanded,
            top: 0,
            itemStyle: {
              color: 'rgba(255,255,255,0.92)',
              borderColor: 'rgba(22,97,171,0.14)',
              textStyle: { color: modelColor.text, fontSize: 10 },
            },
          },
          top: expanded ? 24 : 0,
          left: 0,
          right: 0,
          bottom: 0,
          data,
          visibleMin: 1,
          label: {
            show: true,
            color: 'rgba(11,18,32,0.70)',
            fontSize: compact ? 9 : 11,
            lineHeight: compact ? 11 : 14,
            overflow: 'truncate',
            formatter: '{b}',
          },
          upperLabel: { show: false },
          emphasis: {
            focus: 'self',
            label: {
              color: '#0b1220',
              fontWeight: 700,
            },
            itemStyle: {
              shadowBlur: 10,
              shadowColor: hexToRgba(modelColor.accent, 0.22),
            },
          },
          levels: [
            {
              itemStyle: {
                borderColor: 'rgba(255,255,255,0.92)',
                borderWidth: 2,
                gapWidth: 2,
              },
            },
          ],
        },
      ],
    };
  }, [expanded, items, modelColor]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(22,97,171,0.10)' }}
      loadingLabel="Loading treemap"
    />
  );
}

function EmptyVisual({ message }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-white/25">
      {message}
    </div>
  );
}
