// Biểu đồ SVG nhẹ, co giãn theo màn hình. Chỉ vẽ dữ liệu thật; không có dữ liệu => trạng thái trống.
import { esc } from './util.js';

let uid = 0;
/**
 * data: [{label, value, tip}] ; opts: {yFormat, height, color, emptyText}
 */
export function barChart(data, opts = {}) {
  const id = 'ch' + (++uid);
  if (!data.length || data.every(d => !d.value)) {
    return `<div class="chart-empty">${esc(opts.emptyText || 'Chưa có dữ liệu.')}</div>`;
  }
  const W = Math.max(320, data.length * 22), H = opts.height || 200, pad = { l: 52, r: 8, t: 10, b: 30 };
  const max = opts.max ?? (Math.max(...data.map(d => d.value)) * 1.1 || 1);
  const bw = (W - pad.l - pad.r) / data.length;
  const y = v => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / 12);
  const fmt = opts.yFormat || (v => Math.round(v));
  return `<figure class="chart" id="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || 'Biểu đồ cột')}" preserveAspectRatio="none">
      ${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
        <text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" class="axis">${esc(fmt(t))}</text>`).join('')}
      ${data.map((d, i) => `<g class="bar" tabindex="0" data-tip="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}">
          <rect x="${pad.l + i * bw + bw * 0.15}" y="${y(d.value)}" width="${bw * 0.7}" height="${Math.max(0, H - pad.b - y(d.value))}" rx="2"/>
          <rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" class="hit"/>
          <title>${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}</title>
          ${i % every === 0 ? `<text x="${pad.l + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" class="axis">${esc(d.label)}</text>` : ''}
        </g>`).join('')}
    </svg>
    <figcaption class="chart-tip muted" aria-live="polite">${esc(opts.hint || 'Rê chuột hoặc chạm vào cột để xem chi tiết.')}</figcaption>
  </figure>`;
}

/** Gắn sự kiện hiển thị chú thích cho mọi biểu đồ trong root */
export function bindCharts(root) {
  root.querySelectorAll('.chart').forEach(fig => {
    const tip = fig.querySelector('.chart-tip');
    const show = e => { const g = e.target.closest('.bar'); if (g) { tip.textContent = g.dataset.tip; fig.querySelectorAll('.bar.active').forEach(b => b.classList.remove('active')); g.classList.add('active'); } };
    fig.addEventListener('mouseover', show); fig.addEventListener('click', show); fig.addEventListener('focusin', show);
  });
}
