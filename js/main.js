// ── state ──────────────────────────────────────────────────────────────────
let allData = [];
let state = {
  district: null, priceMin: 5000, priceMax: 150000,
  subway: false, elevator: false, renovation: 0,
  timeStart: null, timeEnd: null,
};
const RENO = ['全部','毛坯','简装','精装','豪装'];
const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([10000, 100000]);

// ── tooltip ────────────────────────────────────────────────────────────────
const tip = d3.select('#tooltip');
function showTip(e, d) {
  tip.style('opacity', 1).html(
    `<b style="color:#ef9a9a">${d.district}</b><br>
     单价：<b>${d.price.toLocaleString()}</b> 元/㎡<br>
     总价：${d.totalPrice} 万 &nbsp; 面积：${d.square} ㎡<br>
     装修：${RENO[d.renovation]||'—'} &nbsp; 地铁：${d.subway?'✓':'✗'} &nbsp; 电梯：${d.elevator?'✓':'✗'}<br>
     成交：${d.tradeTime}`
  );
  moveTip(e);
}
function moveTip(e) { tip.style('left',(e.clientX+14)+'px').style('top',(e.clientY-10)+'px'); }
function hideTip() { tip.style('opacity', 0); }

// ── filters ────────────────────────────────────────────────────────────────
function applyFilters(data) {
  return data.filter(d =>
    d.price >= state.priceMin && d.price <= state.priceMax &&
    (!state.subway || d.subway === 1) &&
    (!state.elevator || d.elevator === 1) &&
    (!state.renovation || d.renovation === state.renovation) &&
    (!state.district || d.district === state.district) &&
    (!state.timeStart || d.tradeTime >= state.timeStart) &&
    (!state.timeEnd || d.tradeTime <= state.timeEnd)
  );
}
function applyFiltersNoDistrict(data) {
  return data.filter(d =>
    d.price >= state.priceMin && d.price <= state.priceMax &&
    (!state.subway || d.subway === 1) &&
    (!state.elevator || d.elevator === 1) &&
    (!state.renovation || d.renovation === state.renovation) &&
    (!state.timeStart || d.tradeTime >= state.timeStart) &&
    (!state.timeEnd || d.tradeTime <= state.timeEnd)
  );
}

// ── stats panel ────────────────────────────────────────────────────────────
function updateStats(data) {
  const prices = data.map(d => d.price).sort(d3.ascending);
  d3.select('#s-count').text(data.length.toLocaleString());
  d3.select('#s-avg').text(data.length ? Math.round(d3.mean(prices)).toLocaleString() : '—');
  d3.select('#s-med').text(data.length ? Math.round(d3.quantile(prices, 0.5)).toLocaleString() : '—');
}

// ── LEAFLET MAP ────────────────────────────────────────────────────────────
let leafMap, renderer, markerLayer = [];
let hoveredDistrict = null;

function initLeafletMap() {
  leafMap = L.map('map', { zoomControl: true, preferCanvas: true })
    .setView([39.95, 116.4], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB', maxZoom: 18, subdomains: 'abcd'
  }).addTo(leafMap);
  buildLegend();
}

function buildLegend() {
  const wrap = document.getElementById('map-legend');
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 10;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = colorScale(10000 + i / 120 * 90000);
    ctx.fillRect(i, 0, 1, 10);
  }
  wrap.innerHTML = '<div style="font-size:11px;color:#90a4ae;margin-bottom:3px">单价（元/㎡）</div>';
  wrap.appendChild(canvas);
  const row = document.createElement('div');
  row.className = 'leg-row';
  row.innerHTML = '<span>1万</span><span>10万</span>';
  wrap.appendChild(row);
}

function updateMarkers() {
  markerLayer.forEach(m => leafMap.removeLayer(m));
  markerLayer = [];
  const data = applyFilters(allData);
  data.forEach(d => {
    const m = L.circleMarker([d.lat, d.lng], {
      radius: 4, fillColor: colorScale(d.price),
      color: 'transparent', fillOpacity: 0.75, weight: 0
    });
    m.on('mouseover', e => { showTip(e.originalEvent, d); highlightBarDistrict(d.district); })
     .on('mousemove', e => moveTip(e.originalEvent))
     .on('mouseout', () => { hideTip(); highlightBarDistrict(null); });
    m.addTo(leafMap);
    markerLayer.push(m);
  });
  updateStats(data);
}

// ── BAR CHART ──────────────────────────────────────────────────────────────
const bm = { top: 8, right: 10, bottom: 58, left: 52 };
let barG, xBar, yBar;

function initBar() {
  const el = document.getElementById('bar');
  const w = el.parentElement.clientWidth - 24, h = el.parentElement.clientHeight - 46;
  barSvg.attr('viewBox', `0 0 ${w} ${h}`);
  const bw = w - bm.left - bm.right, bh = h - bm.top - bm.bottom;
  barG = barSvg.append('g').attr('transform', `translate(${bm.left},${bm.top})`);
  const districts = [...new Set(allData.map(d => d.district))].sort();
  xBar = d3.scaleBand().domain(districts).range([0, bw]).padding(0.28);
  yBar = d3.scaleLinear().range([bh, 0]);
  barG.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${bh})`)
    .call(d3.axisBottom(xBar).tickSize(0))
    .selectAll('text').attr('transform','rotate(-35)').attr('text-anchor','end').attr('font-size',10).attr('fill','#607d8b');
  barG.append('g').attr('class', 'y-axis axis');
  // grid
  barG.append('g').attr('class','grid')
    .call(d3.axisLeft(yBar).ticks(4).tickSize(-bw).tickFormat(''));
}

function updateBar() {
  const el = document.getElementById('bar');
  const h = el.parentElement.clientHeight - 46;
  const bh = h - bm.top - bm.bottom;
  const data = applyFiltersNoDistrict(allData);
  const byD = d3.rollup(data, v => d3.mean(v, d => d.price), d => d.district);
  const entries = [...byD.entries()].sort((a,b) => b[1]-a[1]);
  yBar.domain([0, d3.max(entries, d => d[1]) * 1.12]);
  barG.select('.y-axis').call(d3.axisLeft(yBar).ticks(4).tickFormat(d => (d/1000).toFixed(0)+'k'));
  barG.select('.grid').call(d3.axisLeft(yBar).ticks(4).tickSize(-(document.getElementById('bar').parentElement.clientWidth-24-bm.left-bm.right)).tickFormat(''));
  barG.selectAll('.bar-rect').data(entries, d => d[0]).join('rect')
    .attr('class','bar-rect')
    .attr('x', d => xBar(d[0])).attr('width', xBar.bandwidth())
    .attr('y', d => yBar(d[1])).attr('height', d => bh - yBar(d[1]))
    .attr('fill', d => colorScale(d[1]))
    .attr('rx', 2)
    .classed('selected', d => d[0] === state.district)
    .classed('dimmed', d => state.district && d[0] !== state.district)
    .on('click', (_, d) => { state.district = state.district === d[0] ? null : d[0]; updateAll(); })
    .on('mouseover', (e, d) => { tip.style('opacity',1).html(`<b>${d[0]}</b><br>均价 ${Math.round(d[1]).toLocaleString()} 元/㎡`); moveTip(e); })
    .on('mousemove', moveTip).on('mouseout', hideTip);
}

function highlightBarDistrict(district) {
  barG && barG.selectAll('.bar-rect')
    .classed('selected', d => d[0] === district)
    .classed('dimmed', d => district && d[0] !== district);
}

const barSvg = d3.select('#bar');

// ── TREND + BRUSH ──────────────────────────────────────────────────────────
const tm = { top: 8, right: 15, bottom: 36, left: 52 };
let trendG, xT, yT, brushObj;
const trendSvg = d3.select('#trend');

function initTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth - 24, h = el.parentElement.clientHeight - 46;
  trendSvg.attr('viewBox', `0 0 ${w} ${h}`);
  const tw = w - tm.left - tm.right, th = h - tm.top - tm.bottom;
  trendG = trendSvg.append('g').attr('transform', `translate(${tm.left},${tm.top})`);
  trendG.append('g').attr('class','x-axis axis').attr('transform',`translate(0,${th})`);
  trendG.append('g').attr('class','y-axis axis');
  trendG.append('g').attr('class','grid');
  trendG.append('path').attr('class','trend-line');
  // brush
  brushObj = d3.brushX().extent([[0,0],[tw,th]])
    .on('end', e => {
      if (!e.selection) { state.timeStart = null; state.timeEnd = null; }
      else {
        const [x0, x1] = e.selection;
        const fmt = d3.timeFormat('%Y-%m');
        state.timeStart = fmt(xT.invert(x0));
        state.timeEnd   = fmt(xT.invert(x1));
      }
      updateMarkersAndBar();
      updateStats(applyFilters(allData));
    });
  trendG.append('g').attr('class','brush').call(brushObj);
}

function updateTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth - 24, h = el.parentElement.clientHeight - 46;
  const tw = w - tm.left - tm.right, th = h - tm.top - tm.bottom;
  const data = applyFilters(allData);
  const byM = d3.rollup(data, v => d3.mean(v, d => d.price), d => d.tradeTime);
  const pts = [...byM.entries()].sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k,v]) => ({ t: d3.timeParse('%Y-%m')(k), v }));
  if (!pts.length) return;
  xT = d3.scaleTime().domain(d3.extent(pts, d => d.t)).range([0, tw]);
  yT = d3.scaleLinear().domain([0, d3.max(pts, d => d.v)*1.12]).range([th, 0]);
  trendG.select('.x-axis').call(d3.axisBottom(xT).ticks(6).tickFormat(d3.timeFormat('%Y')));
  trendG.select('.y-axis').call(d3.axisLeft(yT).ticks(4).tickFormat(d => (d/1000).toFixed(0)+'k'));
  trendG.select('.grid').call(d3.axisLeft(yT).ticks(4).tickSize(-tw).tickFormat(''));
  trendG.select('.trend-line').datum(pts)
    .attr('d', d3.line().x(d => xT(d.t)).y(d => yT(d.v)).curve(d3.curveMonotoneX));
  // dots on trend
  trendG.selectAll('.trend-dot').data(pts).join('circle')
    .attr('class','trend-dot').attr('cx', d => xT(d.t)).attr('cy', d => yT(d.v))
    .attr('r', 2.5).attr('fill','#ef5350').attr('opacity', 0.7)
    .on('mouseover', (e, d) => { tip.style('opacity',1).html(`${d3.timeFormat('%Y年%m月')(d.t)}<br>均价 ${Math.round(d.v).toLocaleString()} 元/㎡`); moveTip(e); })
    .on('mousemove', moveTip).on('mouseout', hideTip);
}

// ── update helpers ─────────────────────────────────────────────────────────
function updateMarkersAndBar() { updateMarkers(); updateBar(); }
function updateAll() { updateMarkers(); updateBar(); updateTrend(); }

// ── controls ───────────────────────────────────────────────────────────────
d3.select('#price-min').on('input', function() {
  state.priceMin = +this.value;
  if (state.priceMin > state.priceMax) { state.priceMax = state.priceMin; d3.select('#price-max').property('value', state.priceMax); }
  d3.select('#price-min-val').text(state.priceMin.toLocaleString());
  updateAll();
});
d3.select('#price-max').on('input', function() {
  state.priceMax = +this.value;
  if (state.priceMax < state.priceMin) { state.priceMin = state.priceMax; d3.select('#price-min').property('value', state.priceMin); }
  d3.select('#price-max-val').text(state.priceMax.toLocaleString());
  updateAll();
});
d3.select('#subway-only').on('change', function() { state.subway = this.checked; updateAll(); });
d3.select('#elevator-only').on('change', function() { state.elevator = this.checked; updateAll(); });
d3.select('#reno-filter').on('change', function() { state.renovation = +this.value; updateAll(); });
d3.select('#reset-btn').on('click', () => {
  Object.assign(state, { district:null, priceMin:5000, priceMax:150000, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null });
  d3.select('#price-min').property('value', 5000);
  d3.select('#price-max').property('value', 150000);
  d3.select('#price-min-val').text('5,000');
  d3.select('#price-max-val').text('150,000');
  d3.select('#subway-only').property('checked', false);
  d3.select('#elevator-only').property('checked', false);
  d3.select('#reno-filter').property('value', 0);
  trendG && trendG.select('.brush').call(brushObj.move, null);
  updateAll();
});

// ── init ───────────────────────────────────────────────────────────────────
d3.json('data/housing.json').then(data => {
  allData = data;
  initLeafletMap();
  initBar();
  initTrend();
  updateAll();
});
