import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, GitCompareArrows, Maximize2, Search, Workflow, X } from 'lucide-react';
import { getModelColor } from '../constants';
import EChartCanvas from './EChartCanvas';

function hexToRgba(hex, alpha) {
  const safe = typeof hex === 'string' && hex.startsWith('#') ? hex : '#1661ab';
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function truncateLabel(label, limit = 22) {
  if (!label) return 'Concept';
  return label.length > limit ? `${label.slice(0, limit - 1)}...` : label;
}

function deriveCrossModelData(results) {
  const modelKeys = results?.metadata?.selected_models ?? [];
  const conceptIndex = new Map();

  for (const key of modelKeys) {
    const features = results?.models_data?.[key]?.report_1_global?.fired_features_summary ?? [];
    for (const feat of features.slice(0, 40)) {
      const label = String(feat.concept_label ?? `Concept ${feat.feature_id}`).trim();
      const conceptKey = label.toLowerCase().replace(/\s+/g, ' ');
      if (!conceptIndex.has(conceptKey)) {
        conceptIndex.set(conceptKey, { concept_key: conceptKey, label, records: [] });
      }
      conceptIndex.get(conceptKey).records.push({
        model_key: key,
        feature_id: feat.feature_id,
        concept_label: label,
        max_activation: feat.max_activation,
        avg_activation: feat.avg_activation,
        fired_token_count: feat.fired_token_count,
      });
    }
  }

  const shared_all = [];
  const partial_overlap = [];
  const unique_by_model = Object.fromEntries(modelKeys.map((key) => [key, []]));

  for (const item of conceptIndex.values()) {
    const modelSet = new Set(item.records.map((r) => r.model_key));
    const avg =
      item.records.reduce((sum, r) => sum + Number(r.max_activation ?? 0), 0) /
      Math.max(item.records.length, 1);
    const normalized = { ...item, model_count: modelSet.size, avg_activation: avg };

    if (modelSet.size === modelKeys.length) shared_all.push(normalized);
    else if (modelSet.size > 1) partial_overlap.push(normalized);
    else if (item.records[0]) unique_by_model[item.records[0].model_key].push(normalized);
  }

  shared_all.sort((a, b) => b.avg_activation - a.avg_activation);
  partial_overlap.sort((a, b) => b.model_count - a.model_count || b.avg_activation - a.avg_activation);

  return {
    shared_all: shared_all.slice(0, 16),
    partial_overlap: partial_overlap.slice(0, 20),
    unique_by_model,
    model_keys: modelKeys,
    total_unique_concepts: conceptIndex.size,
  };
}

export default function CrossModelVisuals({ results }) {
  const [activeView, setActiveView] = useState('alignment');
  const modelKeys = results?.metadata?.selected_models ?? [];
  const data = useMemo(
    () => results?.cross_model_visualization ?? deriveCrossModelData(results),
    [results]
  );

  if (modelKeys.length < 2) return null;

  const tabs = [
    { id: 'alignment', label: 'Alignment', icon: Workflow },
    { id: 'matrix', label: 'Matrix', icon: GitCompareArrows },
    { id: 'sets', label: 'Sets', icon: Boxes },
  ];

  return (
    <div className="glass-card overflow-hidden animate-fade-up">
      <div
        className="px-5 py-4 flex items-center gap-3 border-b border-white/[0.06]"
        style={{ background: 'linear-gradient(90deg, rgba(130,49,142,0.10), rgba(22,97,171,0.09))' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,0.72)',
            border: '1px solid rgba(22,97,171,0.24)',
            color: '#5f1f69',
          }}
        >
          <GitCompareArrows size={16} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Cross-model Concept View</h2>
          <p className="text-[10px] text-white/35 mt-0.5">
            {data.total_unique_concepts ?? 0} concepts across {modelKeys.length} models
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 p-1 rounded-lg bg-white/70 border border-white/[0.08] overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => {
            const selected = activeView === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id)}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-semibold whitespace-nowrap"
                style={{
                  color: selected ? '#5f1f69' : 'rgba(11,18,32,0.56)',
                  background: selected ? 'rgba(130,49,142,0.12)' : 'transparent',
                  border: `1px solid ${selected ? 'rgba(130,49,142,0.28)' : 'transparent'}`,
                }}
                title={label}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-[430px] overflow-hidden">
        {activeView === 'alignment' && (
          <AlignmentView data={data} results={results} modelKeys={modelKeys} />
        )}
        {activeView === 'matrix' && (
          <MatrixView data={data} modelKeys={modelKeys} />
        )}
        {activeView === 'sets' && (
          <SetView data={data} results={results} modelKeys={modelKeys} />
        )}
      </div>
    </div>
  );
}

function AlignmentView({ data, results, modelKeys }) {
  const concepts = [...(data.shared_all ?? []), ...(data.partial_overlap ?? [])].slice(0, 28);

  if (!concepts.length) {
    return <EmptyCross message="No overlapping concepts" />;
  }

  return (
    <CrossChartFrame
      title="Cross-model concept alignment"
      modalContent={
        <AlignmentPanel
          concepts={concepts}
          results={results}
          modelKeys={modelKeys}
          expanded
        />
      }
    >
      <AlignmentPanel
        concepts={concepts.slice(0, 22)}
        results={results}
        modelKeys={modelKeys}
      />
    </CrossChartFrame>
  );
}

function AlignmentPanel({ concepts, results, modelKeys, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[620px]' : 'min-h-[340px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#5f1f69]">
            Cross-model concept alignment
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            graph · drag nodes · scroll to zoom · hover concepts
          </div>
        </div>
        <span className="rounded-md bg-[rgba(130,49,142,0.10)] px-2 py-1 text-[9px] font-semibold text-[#5f1f69]">
          {concepts.length} concepts
        </span>
      </div>
      <AlignmentGraphChart
        concepts={concepts}
        results={results}
        modelKeys={modelKeys}
        expanded={expanded}
      />
    </div>
  );
}

function AlignmentGraphChart({ concepts, results, modelKeys, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const maxAct = Math.max(...concepts.flatMap((concept) => concept.records.map((record) => record.max_activation ?? 0)), 1);
    const modelNodes = modelKeys.map((key, index) => {
      const color = getModelColor(index);
      const name = results?.models_data?.[key]?.model_metadata?.model_name ?? key;
      return {
        id: `model:${key}`,
        name: truncateLabel(name, compact ? 18 : 28),
        rawLabel: name,
        nodeType: 'model',
        symbolSize: compact ? 42 : 56,
        fixed: true,
        x: modelKeys.length > 1 ? 120 + (index / (modelKeys.length - 1)) * 760 : 500,
        y: compact ? 58 : 72,
        itemStyle: {
          color: hexToRgba(color.accent, 0.22),
          borderColor: color.accent,
          borderWidth: 2,
        },
        label: { show: true, color: color.text, fontWeight: 700 },
      };
    });

    const conceptNodes = concepts.map((concept, index) => {
      const avg = concept.avg_activation ?? 0;
      const ratio = avg / maxAct;
      const x = concepts.length > 1 ? 80 + ((index % Math.ceil(concepts.length / 2)) / Math.max(Math.ceil(concepts.length / 2) - 1, 1)) * 840 : 500;
      const y = compact ? 150 + Math.floor(index / Math.ceil(concepts.length / 2)) * 90 : 180 + Math.floor(index / Math.ceil(concepts.length / 2)) * 130;
      return {
        id: `concept:${concept.concept_key}`,
        name: truncateLabel(concept.label, compact ? 16 : 24),
        rawLabel: concept.label,
        nodeType: 'concept',
        value: avg,
        model_count: concept.model_count,
        symbolSize: (compact ? 14 : 18) + Math.sqrt(ratio) * (compact ? 18 : 28),
        x,
        y,
        itemStyle: {
          color: hexToRgba('#82318e', 0.22 + ratio * 0.34),
          borderColor: hexToRgba('#82318e', 0.62),
          borderWidth: 1,
        },
        label: {
          show: expanded ? index < 18 : index < 8,
          color: 'rgba(11,18,32,0.62)',
        },
      };
    });

    const links = concepts.flatMap((concept) => concept.records.map((record) => {
      const modelIndex = modelKeys.indexOf(record.model_key);
      const color = getModelColor(Math.max(modelIndex, 0));
      const ratio = (record.max_activation ?? 0) / maxAct;
      return {
        source: `model:${record.model_key}`,
        target: `concept:${concept.concept_key}`,
        value: record.max_activation ?? 0,
        feature_id: record.feature_id,
        model_key: record.model_key,
        concept_label: concept.label,
        lineStyle: {
          width: 0.8 + ratio * (compact ? 3 : 5),
          color: hexToRgba(color.accent, 0.16 + ratio * 0.36),
        },
      };
    }));

    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(130,49,142,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          if (params.dataType === 'edge') {
            return `<div style="font-weight:700;margin-bottom:4px;">${params.data.concept_label ?? ''}</div>
              <div>${params.data.model_key ?? ''} · feature #${params.data.feature_id ?? ''}</div>
              <div>max activation: <b>${Number(params.data.value ?? 0).toFixed(4)}</b></div>`;
          }
          if (params.data.nodeType === 'model') {
            return `<div style="font-weight:700;">${params.data.rawLabel ?? params.name}</div>`;
          }
          return `<div style="font-weight:700;margin-bottom:4px;">${params.data.rawLabel ?? params.name}</div>
            <div>models: <b>${params.data.model_count ?? 0}</b></div>
            <div>avg activation: <b>${Number(params.data.value ?? 0).toFixed(4)}</b></div>`;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          roam: true,
          draggable: true,
          data: [...modelNodes, ...conceptNodes],
          links,
          edgeSymbol: ['none', 'none'],
          lineStyle: { curveness: 0.12, opacity: 0.72 },
          label: {
            position: 'right',
            fontSize: compact ? 8 : 10,
            formatter: '{b}',
          },
          emphasis: {
            focus: 'adjacency',
            label: { show: true },
            lineStyle: { opacity: 0.95 },
          },
        },
      ],
    };
  }, [concepts, expanded, modelKeys, results]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(130,49,142,0.12)' }}
      loadingLabel="Loading alignment"
    />
  );
}

function MatrixView({ data, modelKeys }) {
  const concepts = [...(data.shared_all ?? []), ...(data.partial_overlap ?? [])].slice(0, 34);

  if (!concepts.length) {
    return <EmptyCross message="No shared concepts" />;
  }

  return (
    <CrossChartFrame
      title="Concept presence matrix"
      modalContent={<MatrixPanel concepts={concepts} modelKeys={modelKeys} expanded />}
    >
      <MatrixPanel concepts={concepts.slice(0, 28)} modelKeys={modelKeys} />
    </CrossChartFrame>
  );
}

function MatrixPanel({ concepts, modelKeys, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[600px]' : 'min-h-[340px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#5f1f69]">
            Concept presence matrix
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            model-colored heatmap · hover values · scroll to browse concepts
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {modelKeys.map((key, index) => {
            const color = getModelColor(index);
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-semibold"
                style={{ background: hexToRgba(color.accent, 0.10), color: color.text }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color.accent }} />
                {truncateLabel(key, expanded ? 18 : 12)}
              </span>
            );
          })}
        </div>
      </div>
      <MatrixGrid concepts={concepts} modelKeys={modelKeys} expanded={expanded} />
    </div>
  );
}

function MatrixGrid({ concepts, modelKeys, expanded = false }) {
  const [selectedCell, setSelectedCell] = useState(null);
  const maxByModel = useMemo(() => new Map(modelKeys.map((key) => {
    const values = concepts
      .map((concept) => concept.records.find((item) => item.model_key === key)?.max_activation ?? 0)
      .filter((value) => value > 0);
    return [key, Math.max(...values, 1)];
  })), [concepts, modelKeys]);

  const selectedConcept = selectedCell ? concepts[selectedCell.row] : null;
  const selectedRecord = selectedCell && selectedConcept
    ? selectedConcept.records.find((record) => record.model_key === modelKeys[selectedCell.col])
    : null;

  return (
    <div className="min-h-0 flex-1 rounded-lg border bg-white/80 p-3" style={{ borderColor: 'rgba(130,49,142,0.12)' }}>
      <div
        className="grid h-full min-h-0 gap-1 overflow-auto pr-1"
        style={{
          gridTemplateColumns: `minmax(${expanded ? 190 : 132}px, 1.15fr) repeat(${modelKeys.length}, minmax(${expanded ? 130 : 96}px, 0.8fr))`,
          gridAutoRows: expanded ? 'minmax(36px, auto)' : 'minmax(30px, auto)',
        }}
      >
        <div className="sticky left-0 top-0 z-20 rounded-md bg-white/95 px-2 py-2 text-[9px] font-bold uppercase tracking-wide text-white/35">
          concept
        </div>
        {modelKeys.map((key, index) => {
          const color = getModelColor(index);
          return (
            <div
              key={key}
              className="sticky top-0 z-10 truncate rounded-md px-2 py-2 text-center text-[9px] font-bold"
              style={{ background: hexToRgba(color.accent, 0.10), color: color.text }}
              title={key}
            >
              {truncateLabel(key, expanded ? 20 : 13)}
            </div>
          );
        })}

        {concepts.map((concept, row) => (
          <div key={concept.concept_key} className="contents">
            <div
              className="sticky left-0 z-10 flex items-center rounded-md px-2 py-1.5 text-[9px] font-semibold"
              style={{
                background: row % 2 ? 'rgba(239,245,255,0.94)' : 'rgba(255,255,255,0.96)',
                color: 'rgba(11,18,32,0.68)',
              }}
              title={concept.label}
            >
              <span className="truncate">{truncateLabel(concept.label, expanded ? 30 : 20)}</span>
            </div>
            {modelKeys.map((key, col) => {
              const color = getModelColor(col);
              const record = concept.records.find((item) => item.model_key === key);
              const activation = record?.max_activation ?? 0;
              const ratio = activation > 0 ? Math.min(activation / (maxByModel.get(key) ?? 1), 1) : 0;
              const selected = selectedCell?.row === row && selectedCell?.col === col;
              return (
                <button
                  key={`${concept.concept_key}:${key}`}
                  type="button"
                  onClick={() => setSelectedCell({ row, col })}
                  className="relative overflow-hidden rounded-md border px-2 py-1.5 text-left transition-transform hover:scale-[1.02]"
                  style={{
                    background: record
                      ? `linear-gradient(135deg, ${hexToRgba(color.accent, 0.18 + ratio * 0.58)}, rgba(255,255,255,0.82))`
                      : 'rgba(226,232,240,0.30)',
                    borderColor: selected
                      ? color.accent
                      : record
                        ? hexToRgba(color.accent, 0.22 + ratio * 0.30)
                        : 'rgba(148,163,184,0.16)',
                    boxShadow: selected ? `0 0 0 2px ${hexToRgba(color.accent, 0.14)}` : 'none',
                  }}
                  title={`${concept.label}\n${key}: ${record ? `#${record.feature_id} max ${Number(activation).toFixed(4)}` : '0.00'}`}
                >
                  {record ? (
                    <>
                      <div className="mono text-[9px] font-bold" style={{ color: color.text }}>
                        {Number(activation).toFixed(2)}
                      </div>
                      <div className="mono mt-0.5 truncate text-[8px] text-white/35">
                        #{record.feature_id}
                      </div>
                    </>
                  ) : (
                    <div className="mono text-center text-[9px] font-bold text-white/35">0.00</div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedCell && selectedConcept && (
        <div
          className="mt-2 rounded-lg border px-3 py-2 text-[10px]"
          style={{ background: 'rgba(255,255,255,0.78)', borderColor: 'rgba(130,49,142,0.12)' }}
        >
          <span className="font-bold text-slate-700">{truncateLabel(selectedConcept.label, 34)}</span>
          <span className="mx-2 text-white/25">·</span>
          <span className="mono text-white/40">{modelKeys[selectedCell.col]}</span>
          <span className="mx-2 text-white/25">·</span>
          <span className="mono" style={{ color: getModelColor(selectedCell.col).text }}>
            {selectedRecord
              ? `feature #${selectedRecord.feature_id} · max ${Number(selectedRecord.max_activation ?? 0).toFixed(4)}`
              : '0.00'}
          </span>
        </div>
      )}
    </div>
  );
}

function CrossChartFrame({ children, title, modalContent }) {
  const [soloOpen, setSoloOpen] = useState(false);
  const webCanvasStyle = { width: 'min(1260px, 100%)' };

  return (
    <div className="w-full h-full p-4">
      <div
        className="group relative w-full h-full rounded-lg overflow-auto bg-white/75"
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
            color: '#5f1f69',
            boxShadow: '0 8px 20px rgba(22,97,171,0.12)',
          }}
          title="Open image view"
        >
          <Maximize2 size={14} />
        </button>
        <div className="w-full h-full min-w-[720px]">{children}</div>
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
              <span className="text-sm font-bold" style={{ color: '#5f1f69' }}>
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
                  color: '#5f1f69',
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

function SetView({ data, results, modelKeys }) {
  return (
    <CrossChartFrame
      title="Cross-model concept sets"
      modalContent={
        <SetExplorer
          data={data}
          results={results}
          modelKeys={modelKeys}
          expanded
        />
      }
    >
      <SetExplorer
        data={data}
        results={results}
        modelKeys={modelKeys}
      />
    </CrossChartFrame>
  );
}

function SetExplorer({ data, results, modelKeys, expanded = false }) {
  const buckets = useMemo(() => {
    const base = [
      {
        id: 'shared',
        title: 'Shared by all',
        subtitle: `${modelKeys.length} / ${modelKeys.length} models`,
        color: {
          accent: '#4f46e5',
          text: '#3730a3',
          bg: 'rgba(79,70,229,0.10)',
          border: 'rgba(79,70,229,0.28)',
        },
        items: data.shared_all ?? [],
      },
      {
        id: 'partial',
        title: 'Partial overlap',
        subtitle: '2+ models',
        color: {
          accent: '#0f766e',
          text: '#0f5f58',
          bg: 'rgba(15,118,110,0.10)',
          border: 'rgba(15,118,110,0.25)',
        },
        items: data.partial_overlap ?? [],
      },
    ];

    const uniqueBuckets = modelKeys.map((key, index) => {
      const color = getModelColor(index);
      const name = results?.models_data?.[key]?.model_metadata?.model_name ?? key;
      return {
        id: `unique:${key}`,
        title: `Only in ${truncateLabel(name, 18)}`,
        subtitle: key,
        color,
        items: data.unique_by_model?.[key] ?? [],
      };
    });

    return [...base, ...uniqueBuckets];
  }, [data, modelKeys, results]);

  const firstBucketWithItems = buckets.find((bucket) => bucket.items.length) ?? buckets[0];
  const [activeBucketId, setActiveBucketId] = useState(firstBucketWithItems?.id ?? 'shared');
  const [query, setQuery] = useState('');
  const [selectedConceptKey, setSelectedConceptKey] = useState(null);
  const activeBucket = buckets.find((bucket) => bucket.id === activeBucketId) ?? firstBucketWithItems;
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const items = activeBucket?.items ?? [];
    if (!normalized) return items;
    return items.filter((item) => {
      const label = String(item.label ?? '').toLowerCase();
      const key = String(item.concept_key ?? '').toLowerCase();
      const recordText = (item.records ?? [])
        .map((record) => `${record.model_key} ${record.feature_id} ${record.concept_label}`)
        .join(' ')
        .toLowerCase();
      return label.includes(normalized) || key.includes(normalized) || recordText.includes(normalized);
    });
  }, [activeBucket, query]);
  const selectedConcept =
    filteredItems.find((item) => item.concept_key === selectedConceptKey) ??
    filteredItems[0] ??
    null;

  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[620px]' : 'min-h-[340px]'}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#5f1f69]">
            Concept set explorer
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            filter sets · click concepts · inspect per-model records
          </div>
        </div>
        <div
          className="flex min-w-[190px] items-center gap-2 rounded-lg border px-2 py-1.5"
          style={{ background: 'rgba(255,255,255,0.78)', borderColor: 'rgba(130,49,142,0.18)' }}
        >
          <Search size={12} style={{ color: activeBucket?.color?.text ?? '#5f1f69' }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search concepts"
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_minmax(250px,0.85fr)]">
        <div className="min-h-0 overflow-y-auto rounded-lg border bg-white/70 p-2" style={{ borderColor: 'rgba(130,49,142,0.12)' }}>
          <div className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wide text-white/35">
            Sets
          </div>
          <div className="space-y-1.5">
            {buckets.map((bucket) => {
              const selected = bucket.id === activeBucketId;
              return (
                <button
                  key={bucket.id}
                  type="button"
                  onClick={() => {
                    setActiveBucketId(bucket.id);
                    setSelectedConceptKey(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-transform hover:-translate-y-0.5"
                  style={{
                    background: selected ? bucket.color.bg : 'rgba(255,255,255,0.54)',
                    borderColor: selected ? bucket.color.border : 'rgba(22,97,171,0.08)',
                    color: selected ? bucket.color.text : 'rgba(11,18,32,0.62)',
                  }}
                >
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: bucket.color.accent }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-bold">{bucket.title}</span>
                    <span className="mono mt-0.5 block truncate text-[8px] text-white/35">{bucket.subtitle}</span>
                  </span>
                  <span
                    className="mono rounded-md px-1.5 py-0.5 text-[8px] font-bold"
                    style={{ background: 'rgba(255,255,255,0.62)', color: bucket.color.text }}
                  >
                    {bucket.items.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto rounded-lg border bg-white/70 p-3" style={{ borderColor: 'rgba(130,49,142,0.12)' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[9px] font-bold uppercase tracking-wide text-white/35">
              Concepts
            </div>
            <span
              className="rounded-md px-2 py-1 text-[9px] font-semibold"
              style={{ background: activeBucket?.color?.bg, color: activeBucket?.color?.text }}
            >
              {filteredItems.length} shown
            </span>
          </div>

          {filteredItems.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => {
                const selected = item.concept_key === selectedConcept?.concept_key;
                const ratio = Math.min((item.avg_activation ?? 0) / Math.max(...filteredItems.map((entry) => entry.avg_activation ?? 0), 1), 1);
                return (
                  <button
                    key={item.concept_key}
                    type="button"
                    onClick={() => setSelectedConceptKey(item.concept_key)}
                    className="rounded-lg border p-2 text-left transition-transform hover:-translate-y-0.5"
                    style={{
                      background: selected
                        ? `linear-gradient(135deg, ${hexToRgba(activeBucket.color.accent, 0.18 + ratio * 0.18)}, rgba(255,255,255,0.90))`
                        : `linear-gradient(135deg, ${hexToRgba(activeBucket.color.accent, 0.06 + ratio * 0.08)}, rgba(255,255,255,0.88))`,
                      borderColor: selected ? activeBucket.color.border : hexToRgba(activeBucket.color.accent, 0.12),
                    }}
                  >
                    <div className="break-words text-[10px] font-bold leading-snug text-slate-800">
                      {truncateLabel(item.label, expanded ? 44 : 34)}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="mono text-[8px] text-white/35">
                        {item.model_count ?? item.records?.length ?? 1} model{(item.model_count ?? item.records?.length ?? 1) === 1 ? '' : 's'}
                      </span>
                      <span className="mono text-[8px] font-semibold" style={{ color: activeBucket.color.text }}>
                        {Number(item.avg_activation ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[160px] items-center justify-center rounded-lg border border-dashed border-white/[0.12] text-xs text-white/25">
              No concepts match this filter.
            </div>
          )}
        </div>

        <ConceptDetail
          concept={selectedConcept}
          modelKeys={modelKeys}
          results={results}
          color={activeBucket?.color}
        />
      </div>
    </div>
  );
}

function ConceptDetail({ concept, modelKeys, results, color }) {
  const recordByModel = useMemo(() => {
    const map = new Map();
    for (const record of concept?.records ?? []) map.set(record.model_key, record);
    return map;
  }, [concept]);

  if (!concept) {
    return (
      <div className="flex min-h-0 items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-white/60 p-4 text-center text-xs text-white/25">
        Select a concept to inspect records.
      </div>
    );
  }

  return (
    <div
      className="min-h-0 overflow-y-auto rounded-lg border bg-white/72 p-3"
      style={{ borderColor: color?.border ?? 'rgba(130,49,142,0.18)' }}
    >
      <div className="mb-3">
        <div className="break-words text-[12px] font-bold leading-snug text-slate-800">
          {concept.label}
        </div>
        <div className="mono mt-1 text-[9px] text-white/35">
          avg max activation {Number(concept.avg_activation ?? 0).toFixed(4)}
        </div>
      </div>

      <div className="space-y-2">
        {modelKeys.map((key, index) => {
          const modelColor = getModelColor(index);
          const record = recordByModel.get(key);
          const modelName = results?.models_data?.[key]?.model_metadata?.model_name ?? key;
          return (
            <div
              key={key}
              className="rounded-lg border p-2"
              style={{
                background: record ? hexToRgba(modelColor.accent, 0.08) : 'rgba(226,232,240,0.24)',
                borderColor: record ? hexToRgba(modelColor.accent, 0.22) : 'rgba(148,163,184,0.16)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: record ? modelColor.accent : 'rgba(148,163,184,0.50)' }} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold" style={{ color: record ? modelColor.text : 'rgba(11,18,32,0.42)' }}>
                  {truncateLabel(modelName, 28)}
                </span>
                <span className="mono text-[8px] text-white/35">
                  {record ? `#${record.feature_id}` : '0.00'}
                </span>
              </div>
              {record && (
                <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                  <MetricPill label="max" value={Number(record.max_activation ?? 0).toFixed(2)} color={modelColor} />
                  <MetricPill label="avg" value={Number(record.avg_activation ?? 0).toFixed(2)} color={modelColor} />
                  <MetricPill label="tok" value={record.fired_token_count ?? 0} color={modelColor} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricPill({ label, value, color }) {
  return (
    <div
      className="rounded-md px-1.5 py-1"
      style={{ background: 'rgba(255,255,255,0.62)', border: `1px solid ${hexToRgba(color.accent, 0.12)}` }}
    >
      <div className="mono text-[8px] font-bold" style={{ color: color.text }}>{value}</div>
      <div className="text-[7px] uppercase tracking-wide text-white/30">{label}</div>
    </div>
  );
}

function EmptyCross({ message }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-white/25">
      {message}
    </div>
  );
}
