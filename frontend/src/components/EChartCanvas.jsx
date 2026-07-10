import { useEffect, useRef, useState } from 'react';

let echartsLoader = null;

function loadECharts() {
  if (!echartsLoader) {
    echartsLoader = Promise.all([
      import('echarts/core'),
      import('echarts/components'),
      import('echarts/charts'),
      import('echarts/renderers'),
    ]).then(([echartsCore, components, charts, renderers]) => {
      echartsCore.use([
        components.GridComponent,
        components.LegendComponent,
        components.TooltipComponent,
        components.DataZoomComponent,
        components.VisualMapComponent,
        components.TitleComponent,
        charts.LineChart,
        charts.ScatterChart,
        charts.HeatmapChart,
        charts.GraphChart,
        charts.TreemapChart,
        renderers.CanvasRenderer,
      ].filter(Boolean));
      return echartsCore;
    });
  }
  return echartsLoader;
}

export default function EChartCanvas({ option, className = '', style, loadingLabel = 'Loading chart' }) {
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return undefined;
    let cancelled = false;
    let chart = null;

    loadECharts().then((echarts) => {
      if (cancelled || !chartRef.current) return;
      chart = echarts.init(chartRef.current, null, { renderer: 'canvas' });
      chartInstanceRef.current = chart;
      setReady(true);
    });

    return () => {
      cancelled = true;
      chart?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      chartInstanceRef.current?.resize();
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || !chartInstanceRef.current || !option) return;
    chartInstanceRef.current.setOption(option, true);
    chartInstanceRef.current.resize();
  }, [option, ready]);

  return (
    <div
      className={`relative ${className}`}
      style={style}
      aria-label={loadingLabel}
    >
      <div ref={chartRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-400">
          {loadingLabel}
        </div>
      )}
    </div>
  );
}
