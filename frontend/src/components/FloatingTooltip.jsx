import { createPortal } from 'react-dom';

function hexToRgba(hex, alpha) {
  const safe = typeof hex === 'string' && hex.startsWith('#') ? hex : '#82318e';
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function FloatingTooltip({ x, y, color, children, width = 260 }) {
  if (x == null || y == null || typeof document === 'undefined') return null;

  const accent = color?.accent ?? '#82318e';
  const text = color?.text ?? '#5f1f69';
  const left = Math.max(10, Math.min(x + 14, window.innerWidth - width - 10));
  const top = Math.max(10, Math.min(y + 14, window.innerHeight - 132));

  return createPortal(
    <div
      className="pointer-events-none fixed rounded-lg border px-3 py-2 text-[10px]"
      style={{
        left,
        top,
        width,
        zIndex: 10000,
        color: '#172033',
        background: 'rgba(255,255,255,0.96)',
        borderColor: hexToRgba(accent, 0.26),
        boxShadow: `0 18px 44px rgba(22,97,171,0.14), 0 8px 24px ${hexToRgba(accent, 0.18)}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        className="absolute inset-x-3 top-0 h-0.5 rounded-full"
        style={{ background: `linear-gradient(90deg, ${hexToRgba(accent, 0.35)}, ${accent})` }}
      />
      <div style={{ color: text }}>{children}</div>
    </div>,
    document.body
  );
}

