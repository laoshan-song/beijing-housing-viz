const RENO = ['全部','毛坯','简装','简装','精装','豪装'];
const BTYPE = {1:'板楼',2:'塔楼',3:'平房',4:'商住两用'};
const colorScale = d3.scaleSequential(d3.interpolatePlasma).domain([120000, 5000]);

let allData = [];
let state = {
  district: null, priceMin: 5000, priceMax: 150000,
  areaMin: 20, areaMax: 500,
  subway: false, elevator: false, renovation: 0,
  timeStart: null, timeEnd: null,
  brushBounds: null,   // {minLng,maxLng,minLat,maxLat}
  metric: 'avgPrice',
  storyMode: false,    // true = narrative controls locked
};

// ── tooltip ────────────────────────────────────────────────────────────────
const tip = d3.select('#tooltip');
function showTip(e, d) {
  tip.style('opacity',1).html(
    `<b style="color:#ffcc80">${d.district}</b><br>
     单价：<b>${d.price.toLocaleString()}</b> 元/㎡<br>
     总价：${d.totalPrice} 万 &nbsp; 面积：${d.square} ㎡<br>
     装修：${RENO[d.renovation]||'—'} &nbsp; 楼型：${BTYPE[d.buildingType]||'—'}<br>
     建成：${d.builtYear||'—'} 年 &nbsp; 地铁：${d.subway?'✓':'✗'} &nbsp; 电梯：${d.elevator?'✓':'✗'}<br>
     成交：${d.tradeTime}`
  );
  moveTip(e);
}
function moveTip(e) { tip.style('left',(e.clientX+14)+'px').style('top',(e.clientY-10)+'px'); }
function hideTip() { tip.style('opacity',0); }

// ── filters ────────────────────────────────────────────────────────────────
function applyFilters(data, {skipDistrict=false, skipBrush=false}={}) {
  return data.filter(d =>
    d.price >= state.priceMin && d.price <= state.priceMax &&
    d.square >= state.areaMin && d.square <= state.areaMax &&
    (!state.subway || d.subway===1) &&
    (!state.elevator || d.elevator===1) &&
    (!state.renovation || d.renovation===state.renovation) &&
    (skipDistrict || !state.district || d.district===state.district) &&
    (!state.timeStart || d.tradeTime>=state.timeStart) &&
    (!state.timeEnd || d.tradeTime<=state.timeEnd) &&
    (skipBrush || !state.brushBounds || (
      d.lng>=state.brushBounds.minLng && d.lng<=state.brushBounds.maxLng &&
      d.lat>=state.brushBounds.minLat && d.lat<=state.brushBounds.maxLat
    ))
  );
}

// ── stats ──────────────────────────────────────────────────────────────────
function updateStats(data) {
  const prices = data.map(d=>d.price).sort(d3.ascending);
  const areas = data.map(d=>d.square).sort(d3.ascending);
  d3.select('#s-count').text(data.length.toLocaleString());
  d3.select('#s-avg').text(data.length ? Math.round(d3.mean(prices)).toLocaleString() : '—');
  d3.select('#s-med').text(data.length ? Math.round(d3.quantile(prices,0.5)).toLocaleString() : '—');
  d3.select('#s-max').text(data.length ? Math.round(d3.max(prices)).toLocaleString() : '—');
  d3.select('#s-min').text(data.length ? Math.round(d3.min(prices)).toLocaleString() : '—');
  d3.select('#s-avgArea').text(data.length ? Math.round(d3.mean(areas)).toLocaleString() : '—');
}

// ── LEAFLET MAP ────────────────────────────────────────────────────────────
let leafMap, indivLayer, clusterLayer;
let brushMode = false, brushRect = null, brushStart = null;

function initLeafletMap() {
  leafMap = L.map('map', { zoomControl: true, preferCanvas: true }).setView([39.95, 116.4], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB', maxZoom: 19, subdomains: 'abcd'
  }).addTo(leafMap);
  indivLayer = L.layerGroup().addTo(leafMap);
  clusterLayer = L.layerGroup().addTo(leafMap);
  leafMap.on('zoomend', onZoomChange);
  buildLegend();
  initMapBrush();
}

function onZoomChange() {
  if (leafMap.getZoom() >= 12) {
    clusterLayer.clearLayers();
    updateIndivMarkers();
  } else {
    indivLayer.clearLayers();
    updateClusterMarkers();
  }
}

function updateIndivMarkers() {
  indivLayer.clearLayers();
  const data = applyFilters(allData);
  data.forEach(d => {
    const col = state.storyStep === 2
      ? (d.elevator ? '#1565c0' : '#e53935')
      : colorScale(d.price);
    L.circleMarker([d.lat, d.lng], {
      radius: 4, fillColor: col, color: '#fff', weight: 0.5, fillOpacity: 0.82
    })
    .on('mouseover', e => { showTip(e.originalEvent, d); highlightBarDistrict(d.district); })
    .on('mousemove', e => moveTip(e.originalEvent))
    .on('mouseout', () => { hideTip(); highlightBarDistrict(null); })
    .addTo(indivLayer);
  });
  updateStats(data);
}

function updateClusterMarkers() {
  clusterLayer.clearLayers();
  const data = applyFilters(allData, {skipDistrict: true});
  const byD = d3.rollup(data, v => ({
    count: v.length,
    avgPrice: d3.mean(v, d => d.price),
    lat: d3.mean(v, d => d.lat),
    lng: d3.mean(v, d => d.lng),
    name: v[0].district
  }), d => d.district);
  byD.forEach(s => {
    const r = Math.max(14, Math.min(44, Math.sqrt(s.count) * 1.8));
    L.circleMarker([s.lat, s.lng], {
      radius: r, fillColor: colorScale(s.avgPrice),
      color: '#fff', weight: 2, fillOpacity: 0.85
    })
    .bindTooltip(`<b>${s.name}</b><br>均价 ${Math.round(s.avgPrice).toLocaleString()} 元/㎡<br>${s.count} 套`, {sticky: true})
    .on('click', () => { state.district = s.name; updateAll(); })
    .addTo(clusterLayer);
  });
  updateStats(data);
}

function updateMapLayer() {
  if (leafMap.getZoom() >= 12) updateIndivMarkers();
  else updateClusterMarkers();
}

// ── MAP BRUSH ──────────────────────────────────────────────────────────────
function initMapBrush() {
  leafMap.on('mousedown', e => {
    if (!brushMode) return;
    brushStart = e.latlng;
    if (brushRect) { leafMap.removeLayer(brushRect); brushRect = null; }
  });
  leafMap.on('mousemove', e => {
    if (!brushMode || !brushStart) return;
    if (brushRect) leafMap.removeLayer(brushRect);
    brushRect = L.rectangle([brushStart, e.latlng], {
      color: '#3949ab', weight: 1.5, fillOpacity: 0.1, dashArray: '4,4'
    }).addTo(leafMap);
  });
  leafMap.on('mouseup', e => {
    if (!brushMode || !brushStart) return;
    const b = brushRect ? brushRect.getBounds() : null;
    brushStart = null;
    if (!b || b.getNorthEast().equals(b.getSouthWest())) return;
    state.brushBounds = {
      minLng: b.getWest(), maxLng: b.getEast(),
      minLat: b.getSouth(), maxLat: b.getNorth()
    };
    updateAll();
  });
}

function toggleBrush() {
  brushMode = !brushMode;
  d3.select('#brush-btn').classed('active', brushMode);
  if (brushMode) {
    leafMap.dragging.disable();
    document.getElementById('map').classList.add('brush-cursor');
  } else {
    leafMap.dragging.enable();
    document.getElementById('map').classList.remove('brush-cursor');
    if (brushRect) { leafMap.removeLayer(brushRect); brushRect = null; }
    state.brushBounds = null;
    updateAll();
  }
}

function buildLegend() {
  const wrap = document.getElementById('map-legend');
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 10;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = colorScale(120000 - i/120*115000);
    ctx.fillRect(i, 0, 1, 10);
  }
  wrap.innerHTML = '<div style="font-size:11px;color:#666;margin-bottom:3px">单价（元/㎡）</div>';
  wrap.appendChild(canvas);
  const row = document.createElement('div');
  row.className = 'leg-row';
  row.innerHTML = '<span>低价</span><span>高价</span>';
  wrap.appendChild(row);
}

// ── BAR CHART ──────────────────────────────────────────────────────────────
const bm = {top:8, right:10, bottom:60, left:58};
let barG, xBar, yBar;
const barSvg = d3.select('#bar');

const METRICS = {
  avgPrice:    { label:'均价（元/㎡）',  agg: v => d3.mean(v, d=>d.price),      fmt: v => (v/1000).toFixed(0)+'k' },
  avgTotal:    { label:'均总价（万元）', agg: v => d3.mean(v, d=>d.totalPrice),  fmt: v => v.toFixed(0) },
  count:       { label:'套数',          agg: v => v.length,                     fmt: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v },
  avgSquare:   { label:'套均面积（㎡）', agg: v => d3.mean(v, d=>d.square),      fmt: v => v.toFixed(0) },
  elevatorRate:{ label:'电梯普及率',    agg: v => d3.mean(v, d=>d.elevator),    fmt: v => (v*100).toFixed(0)+'%' },
  subwayRate:  { label:'地铁覆盖率',    agg: v => d3.mean(v, d=>d.subway),      fmt: v => (v*100).toFixed(0)+'%' },
};

function initBar() {
  const el = document.getElementById('bar');
  const w = el.parentElement.clientWidth - 24, h = el.parentElement.clientHeight - 52;
  barSvg.attr('viewBox', `0 0 ${w} ${h}`);
  const bw = w-bm.left-bm.right, bh = h-bm.top-bm.bottom;
  barG = barSvg.append('g').attr('transform', `translate(${bm.left},${bm.top})`);
  const districts = [...new Set(allData.map(d=>d.district))].sort();
  xBar = d3.scaleBand().domain(districts).range([0,bw]).padding(0.28);
  yBar = d3.scaleLinear().range([bh,0]);
  barG.append('g').attr('class','x-axis axis').attr('transform',`translate(0,${bh})`)
    .call(d3.axisBottom(xBar).tickSize(0))
    .selectAll('text').attr('transform','rotate(-35)').attr('text-anchor','end').attr('font-size',10);
  barG.append('g').attr('class','y-axis axis');
  barG.append('g').attr('class','grid');
  barG.append('text').attr('class','y-label').attr('transform','rotate(-90)')
    .attr('x',-bh/2).attr('y',-50).attr('text-anchor','middle').attr('font-size',10).attr('fill','#aaa');
}

function updateBar() {
  const el = document.getElementById('bar');
  const h = el.parentElement.clientHeight - 52;
  const bh = h-bm.top-bm.bottom, bw = el.parentElement.clientWidth-24-bm.left-bm.right;
  const m = METRICS[state.metric];
  // context: all data without district/brush filter
  const ctxData = applyFilters(allData, {skipDistrict:true, skipBrush:true});
  const ctxByD = d3.rollup(ctxData, m.agg, d=>d.district);
  // focus: brushed data (no district filter)
  const focData = state.brushBounds ? applyFilters(allData, {skipDistrict:true}) : null;
  const focByD = focData ? d3.rollup(focData, m.agg, d=>d.district) : null;

  const entries = [...ctxByD.entries()].sort((a,b)=>b[1]-a[1]);
  yBar.domain([0, d3.max(entries, d=>d[1])*1.12]);
  barG.select('.y-axis').call(d3.axisLeft(yBar).ticks(4).tickFormat(m.fmt));
  barG.select('.grid').call(d3.axisLeft(yBar).ticks(4).tickSize(-bw).tickFormat(''));
  barG.select('.y-label').text(m.label);

  // context bars (gray when brush active)
  barG.selectAll('.bar-rect').data(entries, d=>d[0]).join('rect')
    .attr('class','bar-rect')
    .attr('x', d=>xBar(d[0])).attr('width', xBar.bandwidth())
    .attr('y', d=>yBar(d[1])).attr('height', d=>bh-yBar(d[1]))
    .attr('fill', d => focByD ? '#ccc' : colorScale(state.metric==='avgPrice'?d[1]:50000))
    .attr('rx', 2)
    .classed('selected', d=>d[0]===state.district)
    .classed('dimmed', d=>state.district && d[0]!==state.district && !focByD)
    .on('click', (_,d) => { state.district = state.district===d[0]?null:d[0]; updateAll(); })
    .on('mouseover', (e,d) => { tip.style('opacity',1).html(`<b>${d[0]}</b><br>${m.label}：${m.fmt(d[1])}`); moveTip(e); })
    .on('mousemove', moveTip).on('mouseout', hideTip);

  // focus overlay bars (colored, when brush active)
  if (focByD) {
    barG.selectAll('.bar-focus').data(entries, d=>d[0]).join('rect')
      .attr('class','bar-focus')
      .attr('x', d=>xBar(d[0])).attr('width', xBar.bandwidth())
      .attr('y', d=>{ const v=focByD.get(d[0])||0; return yBar(v); })
      .attr('height', d=>{ const v=focByD.get(d[0])||0; return bh-yBar(v); })
      .attr('fill', d=>colorScale(state.metric==='avgPrice'?(focByD.get(d[0])||0):50000))
      .attr('rx', 2).attr('opacity', 0.9);
  } else {
    barG.selectAll('.bar-focus').remove();
  }
}

function highlightBarDistrict(district) {
  barG && barG.selectAll('.bar-rect')
    .classed('selected', d=>d[0]===district)
    .classed('dimmed', d=>district && d[0]!==district);
}

// ── TREND CHART ────────────────────────────────────────────────────────────
const tm = {top:8, right:15, bottom:36, left:52};
let trendG, xT, yT, brushObj;
const trendSvg = d3.select('#trend');

function initTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth-24, h = el.parentElement.clientHeight-46;
  trendSvg.attr('viewBox', `0 0 ${w} ${h}`);
  const tw = w-tm.left-tm.right, th = h-tm.top-tm.bottom;
  trendG = trendSvg.append('g').attr('transform', `translate(${tm.left},${tm.top})`);
  trendG.append('g').attr('class','x-axis axis').attr('transform',`translate(0,${th})`);
  trendG.append('g').attr('class','y-axis axis');
  trendG.append('g').attr('class','grid');
  trendG.append('path').attr('class','trend-line');
  brushObj = d3.brushX().extent([[0,0],[tw,th]]).on('end', e => {
    if (!e.selection) { state.timeStart=null; state.timeEnd=null; }
    else {
      const fmt = d3.timeFormat('%Y-%m');
      state.timeStart = fmt(xT.invert(e.selection[0]));
      state.timeEnd   = fmt(xT.invert(e.selection[1]));
    }
    updateMapLayer(); updateBar(); updateStats(applyFilters(allData));
  });
  trendG.append('g').attr('class','brush').call(brushObj);
}

function updateTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth-24, h = el.parentElement.clientHeight-46;
  const tw = w-tm.left-tm.right, th = h-tm.top-tm.bottom;
  const data = applyFilters(allData, {skipDistrict:true});
  const byM = d3.rollup(data, v=>d3.mean(v,d=>d.price), d=>d.tradeTime);
  const pts = [...byM.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([k,v])=>({t:d3.timeParse('%Y-%m')(k), v}));
  if (!pts.length) return;
  xT = d3.scaleTime().domain(d3.extent(pts,d=>d.t)).range([0,tw]);
  yT = d3.scaleLinear().domain([0, d3.max(pts,d=>d.v)*1.12]).range([th,0]);
  trendG.select('.x-axis').call(d3.axisBottom(xT).ticks(6).tickFormat(d3.timeFormat('%Y')));
  trendG.select('.y-axis').call(d3.axisLeft(yT).ticks(4).tickFormat(d=>(d/1000).toFixed(0)+'k'));
  trendG.select('.grid').call(d3.axisLeft(yT).ticks(4).tickSize(-tw).tickFormat(''));
  trendG.select('.trend-line').datum(pts)
    .attr('d', d3.line().x(d=>xT(d.t)).y(d=>yT(d.v)).curve(d3.curveMonotoneX));
  trendG.selectAll('.tdot').data(pts).join('circle').attr('class','tdot')
    .attr('cx',d=>xT(d.t)).attr('cy',d=>yT(d.v)).attr('r',2.5)
    .attr('fill','#e53935').attr('opacity',0.7)
    .on('mouseover',(e,d)=>{ tip.style('opacity',1).html(`${d3.timeFormat('%Y年%m月')(d.t)}<br>均价 ${Math.round(d.v).toLocaleString()} 元/㎡`); moveTip(e); })
    .on('mousemove',moveTip).on('mouseout',hideTip);
}

// ── NARRATIVE PANEL ────────────────────────────────────────────────────────
let state_storyStep = 0;
const STEPS = [
  {
    title: '步骤 1/5：全局概览',
    text: '北京房价由什么决定？先看全景：黄色为低价区，紫色为高价区。注意右侧图表，西城与东城的均价遥遥领先——但为什么？让我们深入探索。',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgPrice'});
      leafMap.setView([39.95,116.4], 10);
      d3.select('#metric-select').property('value','avgPrice');
      resetControls();
    }
  },
  {
    title: '步骤 2/5：核心区的"老破小"',
    text: '西城与东城为何这么贵？聚焦这两个区：地图上的紫色点代表高价房源。但看右侧统计——这些高价房的平均面积只有 50-60 ㎡！这就是"老破小"：地段和学区价值完全碾压了物理居住品质。',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgSquare'});
      state.storyStep = 1;
      leafMap.setView([39.91,116.38], 12);
      d3.select('#metric-select').property('value','avgSquare');
      resetControls();
    }
  },
  {
    title: '步骤 3/5：近郊的改善型住宅',
    text: '将视线转移到五环外的大兴与房山。这里的故事截然不同：房源面积普遍 80-100 ㎡，电梯房比例高，但单价反而更低。这是"改善型住宅"——用更大的面积和更好的居住条件换取更低的总价。',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgSquare'});
      state.storyStep = 2;
      leafMap.setView([39.75,116.25], 12);
      d3.select('#metric-select').property('value','avgSquare');
      resetControls();
    }
  },
  {
    title: '步骤 4/5：产业枢纽的溢价',
    text: '然而，空间距离法则也有失效的时候。亦庄开发区虽然同处远郊，却因为强劲的产业聚集效应（国家级经济技术开发区），呈现出"高面积、高电梯普及率、高单价"并存的独特行情。这是产业驱动的房价溢价。',
    action: () => {
      Object.assign(state, {district:'亦庄', priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgPrice'});
      state.storyStep = 3;
      leafMap.setView([39.80,116.50], 12);
      d3.select('#metric-select').property('value','avgPrice');
      resetControls();
    }
  },
  {
    title: '步骤 5/5：自由探索',
    text: '现在，你已经理解了北京房价的三大驱动力：地段/学区（核心区）、改善需求（近郊）、产业聚集（亦庄）。叙事导览已关闭，所有交互工具已解锁。尽情探索吧！',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgPrice'});
      state.storyStep = 4;
      leafMap.setView([39.95,116.4], 10);
      d3.select('#metric-select').property('value','avgPrice');
      resetControls();
      document.getElementById('story-panel').style.display = 'none';
      document.getElementById('free-explore').style.display = 'block';
    }
  }
];

function goToStep(n) {
  state.storyStep = n;
  document.getElementById('free-explore').style.display = 'none';
  const s = STEPS[n];
  document.getElementById('step-indicator').textContent = `${n+1} / ${STEPS.length}`;
  document.getElementById('story-title').textContent = s.title;
  document.getElementById('story-text').textContent = s.text;
  document.getElementById('prev-btn').disabled = n === 0;
  document.getElementById('next-btn').disabled = n === STEPS.length - 1;
  s.action();
  updateAll();
}

document.getElementById('prev-btn').addEventListener('click', () => { if (state_storyStep > 0) goToStep(--state_storyStep); });
document.getElementById('next-btn').addEventListener('click', () => { if (state_storyStep < STEPS.length-1) goToStep(++state_storyStep); });

// ── CONTROLS & INIT ────────────────────────────────────────────────────────
function updateAll() { updateMapLayer(); updateBar(); updateTrend(); }

function resetControls() {
  priceSlider.set([state.priceMin, state.priceMax]);
  areaSlider.set([state.areaMin, state.areaMax]);
  d3.select('#subway-only').property('checked', state.subway);
  d3.select('#elevator-only').property('checked', state.elevator);
  d3.select('#reno-filter').property('value', state.renovation);
  trendG && trendG.select('.brush').call(brushObj.move, null);
}

let priceSlider, areaSlider;

function initSliders() {
  priceSlider = noUiSlider.create(document.getElementById('price-slider'), {
    start: [5000, 150000], connect: true,
    range: {min:5000, max:150000}, step: 1000,
    format: {to: v=>Math.round(v), from: v=>+v}
  });
  priceSlider.on('update', vals => {
    state.priceMin = +vals[0]; state.priceMax = +vals[1];
    d3.select('#price-display').text(`${(+vals[0]).toLocaleString()} – ${(+vals[1]).toLocaleString()}`);
  });
  priceSlider.on('change', () => updateAll());

  areaSlider = noUiSlider.create(document.getElementById('area-slider'), {
    start: [20, 500], connect: true,
    range: {min:20, max:500}, step: 5,
    format: {to: v=>Math.round(v), from: v=>+v}
  });
  areaSlider.on('update', vals => {
    state.areaMin = +vals[0]; state.areaMax = +vals[1];
    d3.select('#area-display').text(`${vals[0]} – ${vals[1]}`);
  });
  areaSlider.on('change', () => updateAll());
}

d3.select('#subway-only').on('change', function() { state.subway=this.checked; updateAll(); });
d3.select('#elevator-only').on('change', function() { state.elevator=this.checked; updateAll(); });
d3.select('#reno-filter').on('change', function() { state.renovation=+this.value; updateAll(); });
d3.select('#metric-select').on('change', function() { state.metric=this.value; updateBar(); });
d3.select('#brush-btn').on('click', toggleBrush);
d3.select('#reset-btn').on('click', () => {
  Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, storyStep:0});
  d3.select('#metric-select').property('value','avgPrice'); state.metric='avgPrice';
  if (brushMode) toggleBrush();
  resetControls();
  updateAll();
});

d3.json('data/housing.json').then(data => {
  allData = data;
  initSliders();
  initLeafletMap();
  initBar();
  initTrend();
  goToStep(0);
});
