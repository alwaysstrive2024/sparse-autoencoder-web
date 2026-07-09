import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, GitCompareArrows, Maximize2, Workflow, X } from 'lucide-react';
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

// function MatrixView({ data, modelKeys }) {
//   const concepts = [...(data.shared_all ?? []), ...(data.partial_overlap ?? [])].slice(0, 34);

//   if (!concepts.length) {
//     return <EmptyCross message="No shared concepts" />;
//   }

//   return (
//     <CrossChartFrame
//       title="Concept presence matrix"
//       modalContent={<MatrixPanel concepts={concepts} modelKeys={modelKeys} expanded />}
//     >
//       <MatrixPanel concepts={concepts.slice(0, 28)} modelKeys={modelKeys} />
//     </CrossChartFrame>
//   );
// }

// function MatrixPanel({ concepts, modelKeys, expanded = false }) {
//   return (
//     <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[600px]' : 'min-h-[340px]'}`}>
//       <div className="mb-2 flex items-start justify-between gap-3">
//         <div>
//           <div className="text-[10px] font-bold text-[#5f1f69]">
//             Concept presence matrix
//           </div>
//           <div className="mt-0.5 text-[9px] text-white/35">
//             heatmap · hover values · scroll to browse concepts
//           </div>
//         </div>
//         <span className="rounded-md bg-[rgba(130,49,142,0.10)] px-2 py-1 text-[9px] font-semibold text-[#5f1f69]">
//           {concepts.length} × {modelKeys.length}
//         </span>
//       </div>
//       <MatrixHeatmapChart concepts={concepts} modelKeys={modelKeys} expanded={expanded} />
//     </div>
//   );
// }

// function MatrixHeatmapChart({ concepts, modelKeys, expanded = false }) {
//   const option = useMemo(() => {
//     const compact = !expanded;
//     const rows = concepts.map((concept) => concept.label);
//     const cells = concepts.flatMap((concept, row) => modelKeys.map((key, col) => {
//       const record = concept.records.find((item) => item.model_key === key);
//       return [
//         col,
//         row,
//         record?.max_activation ?? 0,
//         concept.label,
//         key,
//         record?.feature_id ?? null,
//         Boolean(record),
//       ];
//     }));
//     const maxAct = Math.max(...cells.map((cell) => cell[2]), 1);

//     return {
//       animation: false,
//       grid: {
//         left: compact ? 128 : 190,
//         right: expanded ? 62 : 24,
//         top: 16,
//         bottom: expanded ? 58 : 38,
//       },
//       tooltip: {
//         trigger: 'item',
//         confine: true,
//         appendToBody: true,
//         backgroundColor: 'rgba(255,255,255,0.96)',
//         borderColor: 'rgba(130,49,142,0.18)',
//         textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
//         formatter: (params) => {
//           const value = params.value ?? [];
//           return `<div style="font-weight:700;margin-bottom:4px;">${value[3] ?? ''}</div>
//             <div>model: <b>${value[4] ?? ''}</b></div>
//             <div>${value[6] ? `feature #${value[5]}` : 'absent'}</div>
//             <div>max activation: <b>${Number(value[2] ?? 0).toFixed(4)}</b></div>`;
//         },
//       },
//       visualMap: {
//         min: 0,
//         max: maxAct,
//         show: expanded,
//         calculable: true,
//         orient: 'horizontal',
//         left: 'center',
//         bottom: 10,
//         inRange: { color: ['rgba(255,255,255,0.95)', 'rgba(130,49,142,0.82)'] },
//         textStyle: { color: 'rgba(11,18,32,0.45)', fontSize: 9 },
//       },
//       xAxis: {
//         type: 'category',
//         data: modelKeys,
//         axisTick: { show: false },
//         axisLine: { lineStyle: { color: 'rgba(130,49,142,0.16)' } },
//         axisLabel: {
//           color: 'rgba(11,18,32,0.58)',
//           fontSize: compact ? 9 : 10,
//           interval: 0,
//           hideOverlap: true,
//           formatter: (value) => truncateLabel(value, compact ? 14 : 22),
//         },
//       },
//       yAxis: {
//         type: 'category',
//         data: rows,
//         inverse: true,
//         axisTick: { show: false },
//         axisLine: { show: false },
//         axisLabel: {
//           color: 'rgba(11,18,32,0.58)',
//           fontSize: compact ? 9 : 10,
//           width: compact ? 112 : 174,
//           overflow: 'truncate',
//           formatter: (value) => truncateLabel(value, compact ? 18 : 28),
//         },
//       },
//       dataZoom: [
//         {
//           type: 'inside',
//           yAxisIndex: 0,
//           filterMode: 'none',
//           zoomOnMouseWheel: false,
//           moveOnMouseWheel: true,
//         },
//         {
//           type: 'slider',
//           yAxisIndex: 0,
//           width: expanded ? 18 : 12,
//           right: expanded ? 12 : 5,
//           borderColor: 'rgba(130,49,142,0.10)',
//           fillerColor: 'rgba(130,49,142,0.12)',
//           handleStyle: { color: '#82318e', borderColor: '#82318e' },
//           showDetail: false,
//           showDataShadow: false,
//         },
//       ],
//       series: [
//         {
//           type: 'heatmap',
//           data: cells,
//           label: {
//             show: expanded && modelKeys.length <= 4,
//             color: 'rgba(11,18,32,0.58)',
//             fontSize: 9,
//             formatter: (params) => Number(params.value?.[2] ?? 0) > 0 ? Number(params.value[2]).toFixed(1) : '',
//           },
//           emphasis: {
//             itemStyle: {
//               borderColor: '#82318e',
//               borderWidth: 1,
//             },
//           },
//         },
//       ],
//     };
//   }, [concepts, expanded, modelKeys]);

//   return (
//     <EChartCanvas
//       option={option}
//       className="min-h-0 flex-1 rounded-lg border bg-white/80"
//       style={{ borderColor: 'rgba(130,49,142,0.12)' }}
//       loadingLabel="Loading matrix"
//     />
//   );
// }

// function MatrixView({ data, modelKeys }) {
//   const concepts = [...(data.shared_all ?? []), ...(data.partial_overlap ?? [])].slice(0, 34);

//   if (!concepts.length) {
//     return <EmptyCross message="No shared concepts" />;
//   }

//   return (
//     <CrossChartFrame
//       title="Concept presence matrix"
//       modalContent={<MatrixPanel concepts={concepts} modelKeys={modelKeys} expanded />}
//     >
//       <MatrixPanel concepts={concepts.slice(0, 28)} modelKeys={modelKeys} />
//     </CrossChartFrame>
//   );
// }

function MatrixPanel({ concepts, modelKeys, expanded = false }) {
  return (
    <div className={`flex h-full w-full flex-col rounded-lg bg-white/75 p-4 ${expanded ? 'min-h-[600px]' : 'min-h-[340px]'}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#5f1f69]">
            Concept presence matrix
          </div>
          <div className="mt-0.5 text-[9px] text-white/35">
            heatmap · hover values · scroll to browse concepts
          </div>
        </div>
        <span className="rounded-md bg-[rgba(130,49,142,0.10)] px-2 py-1 text-[9px] font-semibold text-[#5f1f69]">
          {concepts.length} × {modelKeys.length}
        </span>
      </div>
      <MatrixHeatmapChart concepts={concepts} modelKeys={modelKeys} expanded={expanded} />
    </div>
  );
}

function MatrixHeatmapChart({ concepts, modelKeys, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const rows = concepts.map((concept) => concept.label);
    const cells = concepts.flatMap((concept, row) => modelKeys.map((key, col) => {
      const record = concept.records.find((item) => item.model_key === key);
      return [
        col,
        row,
        record?.max_activation ?? 0,
        concept.label,
        key,
        record?.feature_id ?? null,
        Boolean(record),
      ];
    }));
    const maxAct = Math.max(...cells.map((cell) => cell[2]), 1);

    return {
      animation: false,
      grid: {
        left: compact ? 128 : 190,
        right: expanded ? 62 : 24,
        top: 16,
        bottom: expanded ? 58 : 38,
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(130,49,142,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          const value = params.value ?? [];
          return `<div style="font-weight:700;margin-bottom:4px;">${value[3] ?? ''}</div>
            <div>model: <b>${value[4] ?? ''}</b></div>
            <div>${value[6] ? `feature #${value[5]}` : 'absent'}</div>
            <div>max activation: <b>${Number(value[2] ?? 0).toFixed(4)}</b></div>`;
        },
      },
      visualMap: {
        min: 0,
        max: maxAct,
        show: expanded,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
        inRange: { color: ['rgba(255,255,255,0.95)', 'rgba(130,49,142,0.82)'] },
        textStyle: { color: 'rgba(11,18,32,0.45)', fontSize: 9 },
      },
      xAxis: {
        type: 'category',
        data: modelKeys,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(130,49,142,0.16)' } },
        axisLabel: {
          color: 'rgba(11,18,32,0.58)',
          fontSize: compact ? 9 : 10,
          interval: 0,
          hideOverlap: true,
          formatter: (value) => truncateLabel(value, compact ? 14 : 22),
        },
      },
      yAxis: {
        type: 'category',
        data: rows,
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: 'rgba(11,18,32,0.58)',
          fontSize: compact ? 9 : 10,
          width: compact ? 112 : 174,
          overflow: 'truncate',
          formatter: (value) => truncateLabel(value, compact ? 18 : 28),
        },
      },
      dataZoom: [
        {
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseWheel: true,
        },
        {
          type: 'slider',
          yAxisIndex: 0,
          width: expanded ? 18 : 12,
          right: expanded ? 12 : 5,
          borderColor: 'rgba(130,49,142,0.10)',
          fillerColor: 'rgba(130,49,142,0.12)',
          handleStyle: { color: '#82318e', borderColor: '#82318e' },
          showDetail: false,
          showDataShadow: false,
        },
      ],
      series: [
        {
          type: 'heatmap',
          data: cells,
          label: {
            show: expanded && modelKeys.length <= 4,
            color: 'rgba(11,18,32,0.58)',
            fontSize: 9,
            formatter: (params) => Number(params.value?.[2] ?? 0) > 0 ? Number(params.value[2]).toFixed(1) : '',
          },
          emphasis: {
            itemStyle: {
              borderColor: '#82318e',
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [concepts, expanded, modelKeys]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(130,49,142,0.12)' }}
      loadingLabel="Loading matrix"
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
            heatmap · hover values · scroll to browse concepts
          </div>
        </div>
        <span className="rounded-md bg-[rgba(130,49,142,0.10)] px-2 py-1 text-[9px] font-semibold text-[#5f1f69]">
          {concepts.length} × {modelKeys.length}
        </span>
      </div>
      <MatrixHeatmapChart concepts={concepts} modelKeys={modelKeys} expanded={expanded} />
    </div>
  );
}

function MatrixHeatmapChart({ concepts, modelKeys, expanded = false }) {
  const option = useMemo(() => {
    const compact = !expanded;
    const rows = concepts.map((concept) => concept.label);
    const cells = concepts.flatMap((concept, row) => modelKeys.map((key, col) => {
      const record = concept.records.find((item) => item.model_key === key);
      return [
        col,
        row,
        record?.max_activation ?? 0,
        concept.label,
        key,
        record?.feature_id ?? null,
        Boolean(record),
      ];
    }));
    const maxAct = Math.max(...cells.map((cell) => cell[2]), 1);

    return {
      animation: false,
      grid: {
        left: compact ? 128 : 190,
        right: expanded ? 62 : 24,
        top: 16,
        bottom: expanded ? 58 : 38,
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(130,49,142,0.18)',
        textStyle: { color: '#172033', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
        formatter: (params) => {
          const value = params.value ?? [];
          return `<div style="font-weight:700;margin-bottom:4px;">${value[3] ?? ''}</div>
            <div>model: <b>${value[4] ?? ''}</b></div>
            <div>${value[6] ? `feature #${value[5]}` : 'absent'}</div>
            <div>max activation: <b>${Number(value[2] ?? 0).toFixed(4)}</b></div>`;
        },
      },
      visualMap: {
        min: 0,
        max: maxAct,
        show: expanded,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
        inRange: { color: ['rgba(255,255,255,0.95)', 'rgba(130,49,142,0.82)'] },
        textStyle: { color: 'rgba(11,18,32,0.45)', fontSize: 9 },
      },
      xAxis: {
        type: 'category',
        data: modelKeys,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(130,49,142,0.16)' } },
        axisLabel: {
          color: 'rgba(11,18,32,0.58)',
          fontSize: compact ? 9 : 10,
          interval: 0,
          hideOverlap: true,
          formatter: (value) => truncateLabel(value, compact ? 14 : 22),
        },
      },
      yAxis: {
        type: 'category',
        data: rows,
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: 'rgba(11,18,32,0.58)',
          fontSize: compact ? 9 : 10,
          width: compact ? 112 : 174,
          overflow: 'truncate',
          formatter: (value) => truncateLabel(value, compact ? 18 : 28),
        },
      },
      dataZoom: [
        {
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseWheel: true,
        },
        {
          type: 'slider',
          yAxisIndex: 0,
          width: expanded ? 18 : 12,
          right: expanded ? 12 : 5,
          borderColor: 'rgba(130,49,142,0.10)',
          fillerColor: 'rgba(130,49,142,0.12)',
          handleStyle: { color: '#82318e', borderColor: '#82318e' },
          showDetail: false,
          showDataShadow: false,
        },
      ],
      series: [
        {
          type: 'heatmap',
          data: cells,
          label: {
            show: expanded && modelKeys.length <= 4,
            color: 'rgba(11,18,32,0.58)',
            fontSize: 9,
            formatter: (params) => Number(params.value?.[2] ?? 0) > 0 ? Number(params.value[2]).toFixed(1) : '',
          },
          emphasis: {
            itemStyle: {
              borderColor: '#82318e',
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [concepts, expanded, modelKeys]);

  return (
    <EChartCanvas
      option={option}
      className="min-h-0 flex-1 rounded-lg border bg-white/80"
      style={{ borderColor: 'rgba(130,49,142,0.12)' }}
      loadingLabel="Loading matrix"
    />
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
  const shared = data.shared_all ?? [];
  const partial = data.partial_overlap ?? [];

  return (
    <div className="h-full overflow-auto p-4">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(modelKeys.length + 1, 4)}, minmax(220px, 1fr))` }}
      >
        <ConceptBucket
          title="Shared by all"
          color={{
            accent: '#4f46e5',
            text: '#3730a3',
            bg: 'rgba(79,70,229,0.10)',
            border: 'rgba(79,70,229,0.28)',
          }}
          items={shared}
        />
        {modelKeys.map((key, index) => {
          const color = getModelColor(index);
          const name = results?.models_data?.[key]?.model_metadata?.model_name ?? key;
          return (
            <ConceptBucket
              key={key}
              title={`Only in ${truncateLabel(name, 18)}`}
              color={color}
              items={data.unique_by_model?.[key] ?? []}
            />
          );
        })}
      </div>
      <div className="mt-4">
        <ConceptBucket
          title="Partial overlap"
          color={{
            accent: '#0f766e',
            text: '#0f5f58',
            bg: 'rgba(15,118,110,0.10)',
            border: 'rgba(15,118,110,0.25)',
          }}
          items={partial}
          wide
        />
      </div>
    </div>
  );
}

function ConceptBucket({ title, color, items, wide }) {
  return (
    <div
      className={`rounded-xl p-4 ${wide ? 'min-h-[110px]' : 'min-h-[180px]'}`}
      style={{ background: color.bg, border: `1px solid ${color.border}` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ background: color.accent }} />
        <span className="text-[11px] font-bold" style={{ color: color.text }}>
          {title}
        </span>
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.slice(0, wide ? 18 : 10).map((item) => (
            <span
              key={item.concept_key}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              style={{
                background: 'rgba(255,255,255,0.62)',
                border: `1px solid ${color.border}`,
                color: color.text,
              }}
              title={`avg max activation ${Number(item.avg_activation).toFixed(3)}`}
            >
              {truncateLabel(item.label, 22)}
              <span className="mono opacity-60">{Number(item.avg_activation).toFixed(1)}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-white/25">No concepts</p>
      )}
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
