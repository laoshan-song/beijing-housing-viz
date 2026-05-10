// ── constants & state ──────────────────────────────────────────────────────
const RENO  = ['全部','毛坯','简装','简装','精装','豪装'];
const BTYPE = {1:'板楼',2:'塔楼',3:'平房',4:'商住两用'};
const colorScale = d3.scaleSequential(d3.interpolatePlasma).domain([120000, 5000]);

let allData = [];
let state = {
  district: null, priceMin: 5000, priceMax: 150000,
  areaMin: 20, areaMax: 500,
  subway: false, elevator: false, renovation: 0,
  timeStart: null, timeEnd: null,
  brushBounds: null,
  metric: 'avgPrice',
  storyStep: 0,
};

// ── tooltip ────────────────────────────────────────────────────────────────
const tip = d3.select('#tooltip');
function showTip(e, html) { tip.style('opacity',1).html(html); moveTip(e); }
function showDotTip(e, d) {
  showTip(e,
    `<b style="color:#ffcc80">${d.district}</b><br>
     单价：<b>${d.price.toLocaleString()}</b> 元/㎡<br>
     总价：${d.totalPrice} 万 &nbsp; 面积：${d.square} ㎡<br>
     楼型：${BTYPE[d.buildingType]||'—'} &nbsp; 建成：${d.builtYear||'—'} 年<br>
     装修：${RENO[d.renovation]||'—'} &nbsp; 地铁：${d.subway?'✓':'✗'} &nbsp; 电梯：${d.elevator?'✓':'✗'}<br>
     成交：${d.tradeTime}`
  );
}
function moveTip(e) { tip.style('left',(e.clientX+14)+'px').style('top',(e.clientY-10)+'px'); }
function hideTip() { tip.style('opacity',0); }

// ── filters ────────────────────────────────────────────────────────────────
function applyFilters(data, {skipDistrict=false, skipBrush=false}={}) {
  return data.filter(d =>
    d.price  >= state.priceMin  && d.price  <= state.priceMax &&
    d.square >= state.areaMin   && d.square <= state.areaMax  &&
    (!state.subway    || d.subway    === 1) &&
    (!state.elevator  || d.elevator  === 1) &&
    (!state.renovation|| d.renovation=== state.renovation) &&
    (skipDistrict || !state.district || d.district === state.district) &&
    (!state.timeStart || d.tradeTime >= state.timeStart) &&
    (!state.timeEnd   || d.tradeTime <= state.timeEnd) &&
    (skipBrush || !state.brushBounds || (
      d.lng >= state.brushBounds.minLng && d.lng <= state.brushBounds.maxLng &&
      d.lat >= state.brushBounds.minLat && d.lat <= state.brushBounds.maxLat
    ))
  );
}

// ── stats ──────────────────────────────────────────────────────────────────
function animateNum(sel, val) {
  const el = document.getElementById(sel);
  if (!el) return;
  const prev = +(el.dataset.raw || 0);
  const target = val;
  el.dataset.raw = target;
  const dur = 400, steps = 20;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const t = i / steps;
    const cur = Math.round(prev + (target - prev) * (1 - Math.pow(1-t, 3)));
    el.textContent = cur.toLocaleString();
    if (i >= steps) { el.textContent = target.toLocaleString(); clearInterval(timer); }
  }, dur / steps);
}
function updateStats(data) {
  const prices = data.map(d=>d.price).sort(d3.ascending);
  const areas  = data.map(d=>d.square);
  animateNum('s-count',   data.length);
  animateNum('s-avg',     data.length ? Math.round(d3.mean(prices))           : 0);
  animateNum('s-med',     data.length ? Math.round(d3.quantile(prices, 0.5))  : 0);
  animateNum('s-max',     data.length ? Math.round(d3.max(prices))            : 0);
  animateNum('s-min',     data.length ? Math.round(d3.min(prices))            : 0);
  animateNum('s-avgArea', data.length ? Math.round(d3.mean(areas))            : 0);
}

// ── LEAFLET MAP ────────────────────────────────────────────────────────────
let leafMap, indivLayer, clusterLayer;
let brushMode = false, brushRect = null, brushStart = null;

function initLeafletMap() {
  leafMap = L.map('map', {zoomControl:true, preferCanvas:true}).setView([39.95,116.4], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:'© OpenStreetMap © CartoDB', maxZoom:19, subdomains:'abcd'
  }).addTo(leafMap);
  indivLayer   = L.layerGroup().addTo(leafMap);
  clusterLayer = L.layerGroup().addTo(leafMap);
  leafMap.on('zoomend', onZoomChange);
  buildLegend();
  initMapBrush();
}

function onZoomChange() {
  if (leafMap.getZoom() >= 12) { clusterLayer.clearLayers(); updateIndivMarkers(); }
  else { indivLayer.clearLayers(); updateClusterMarkers(); }
}

function updateIndivMarkers() {
  indivLayer.clearLayers();
  const data = applyFilters(allData);
  data.forEach(d => {
    L.circleMarker([d.lat, d.lng], {
      radius:4, fillColor:colorScale(d.price), color:'#fff', weight:0.6, fillOpacity:0.85
    })
    .on('mouseover', e => { showDotTip(e.originalEvent, d); highlightBarDistrict(d.district); })
    .on('mousemove', e => moveTip(e.originalEvent))
    .on('mouseout',  () => { hideTip(); highlightBarDistrict(null); })
    .addTo(indivLayer);
  });
  updateStats(data);
}

function updateClusterMarkers() {
  clusterLayer.clearLayers();
  const data = applyFilters(allData, {skipDistrict:true});
  const byD = d3.rollup(data, v => ({
    count: v.length, avgPrice: d3.mean(v, d=>d.price),
    lat: d3.mean(v, d=>d.lat), lng: d3.mean(v, d=>d.lng), name: v[0].district
  }), d => d.district);
  byD.forEach(s => {
    const r = Math.max(14, Math.min(44, Math.sqrt(s.count)*1.8));
    L.circleMarker([s.lat, s.lng], {
      radius:r, fillColor:colorScale(s.avgPrice), color:'#fff', weight:2, fillOpacity:0.88
    })
    .bindTooltip(`<b>${s.name}</b><br>均价 ${Math.round(s.avgPrice).toLocaleString()} 元/㎡<br>${s.count} 套`, {sticky:true})
    .on('click', () => { state.district = s.name; updateAll(); })
    .addTo(clusterLayer);
  });
  updateStats(data);
}

function updateMapLayer() {
  if (leafMap.getZoom() >= 12) updateIndivMarkers(); else updateClusterMarkers();
}

// map brush
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
      color:'#3949ab', weight:1.5, fillOpacity:0.08, dashArray:'5,4'
    }).addTo(leafMap);
  });
  leafMap.on('mouseup', e => {
    if (!brushMode || !brushStart) return;
    const b = brushRect ? brushRect.getBounds() : null;
    brushStart = null;
    if (!b || b.getNorthEast().equals(b.getSouthWest())) return;
    state.brushBounds = {minLng:b.getWest(), maxLng:b.getEast(), minLat:b.getSouth(), maxLat:b.getNorth()};
    updateAll();
  });
}

function toggleBrush() {
  brushMode = !brushMode;
  d3.select('#brush-btn').classed('active', brushMode);
  if (brushMode) { leafMap.dragging.disable(); document.getElementById('map').classList.add('brush-cursor'); }
  else {
    leafMap.dragging.enable(); document.getElementById('map').classList.remove('brush-cursor');
    if (brushRect) { leafMap.removeLayer(brushRect); brushRect = null; }
    state.brushBounds = null; updateAll();
  }
}

function buildLegend() {
  const wrap = document.getElementById('map-legend');
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 10;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = colorScale(5000 + i/120*115000);
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
const bm = {top:8, right:12, bottom:60, left:58};
let barG, xBar, yBar;
const barSvg = d3.select('#bar');

const METRICS = {
  avgPrice:    {label:'均价（元/㎡）',  agg:v=>d3.mean(v,d=>d.price),     fmt:v=>(v/1000).toFixed(0)+'k'},
  avgTotal:    {label:'均总价（万元）', agg:v=>d3.mean(v,d=>d.totalPrice), fmt:v=>v.toFixed(0)},
  count:       {label:'套数',          agg:v=>v.length,                   fmt:v=>v>=1000?(v/1000).toFixed(1)+'k':v},
  avgSquare:   {label:'套均面积（㎡）', agg:v=>d3.mean(v,d=>d.square),    fmt:v=>v.toFixed(0)},
  elevatorRate:{label:'电梯普及率',    agg:v=>d3.mean(v,d=>d.elevator),  fmt:v=>(v*100).toFixed(0)+'%'},
  subwayRate:  {label:'地铁覆盖率',    agg:v=>d3.mean(v,d=>d.subway),    fmt:v=>(v*100).toFixed(0)+'%'},
};

function initBar() {
  const el = document.getElementById('bar');
  const w = el.parentElement.clientWidth-24, h = el.parentElement.clientHeight-52;
  barSvg.attr('viewBox',`0 0 ${w} ${h}`);
  const bw = w-bm.left-bm.right, bh = h-bm.top-bm.bottom;
  barG = barSvg.append('g').attr('transform',`translate(${bm.left},${bm.top})`);
  const districts = [...new Set(allData.map(d=>d.district))].sort();
  xBar = d3.scaleBand().domain(districts).range([0,bw]).padding(0.3);
  yBar = d3.scaleLinear().range([bh,0]);
  barG.append('g').attr('class','x-axis axis').attr('transform',`translate(0,${bh})`)
    .call(d3.axisBottom(xBar).tickSize(0))
    .selectAll('text').attr('transform','rotate(-35)').attr('text-anchor','end').attr('font-size',10);
  barG.append('g').attr('class','y-axis axis');
  barG.append('g').attr('class','grid');
  barG.append('text').attr('class','y-label').attr('transform','rotate(-90)')
    .attr('x',-bh/2).attr('y',-50).attr('text-anchor','middle').attr('font-size',10).attr('fill','#bbb');
}

function updateBar() {
  const el = document.getElementById('bar');
  const h = el.parentElement.clientHeight-52;
  const bh = h-bm.top-bm.bottom, bw = el.parentElement.clientWidth-24-bm.left-bm.right;
  const m = METRICS[state.metric];
  const ctxData = applyFilters(allData, {skipDistrict:true, skipBrush:true});
  const ctxByD  = d3.rollup(ctxData, m.agg, d=>d.district);
  const focData = state.brushBounds ? applyFilters(allData, {skipDistrict:true}) : null;
  const focByD  = focData ? d3.rollup(focData, m.agg, d=>d.district) : null;
  const entries = [...ctxByD.entries()].sort((a,b)=>b[1]-a[1]);

  yBar.domain([0, d3.max(entries, d=>d[1])*1.18]);
  barG.select('.y-axis').call(d3.axisLeft(yBar).ticks(4).tickFormat(m.fmt));
  barG.select('.grid').call(d3.axisLeft(yBar).ticks(4).tickSize(-bw).tickFormat(''));
  barG.select('.y-label').text(m.label);

  // context bars
  barG.selectAll('.bar-rect').data(entries, d=>d[0]).join(
    enter => enter.append('rect').attr('class','bar-rect').attr('rx',3)
      .attr('x',d=>xBar(d[0])).attr('width',xBar.bandwidth())
      .attr('y',bh).attr('height',0),
    update => update,
    exit => exit.remove()
  )
  .classed('selected', d=>d[0]===state.district)
  .classed('dimmed',   d=>state.district && d[0]!==state.district && !focByD)
  .attr('fill', d => focByD ? '#ddd' : colorScale(state.metric==='avgPrice'?d[1]:50000))
  .transition().duration(350)
  .attr('x',d=>xBar(d[0])).attr('width',xBar.bandwidth())
  .attr('y',d=>yBar(d[1])).attr('height',d=>bh-yBar(d[1]));

  barG.selectAll('.bar-rect')
    .on('click', (_,d) => { state.district = state.district===d[0]?null:d[0]; updateAll(); })
    .on('mouseover',(e,d)=>{ showTip(e,`<b>${d[0]}</b><br>${m.label}：${m.fmt(d[1])}`); })
    .on('mousemove',moveTip).on('mouseout',hideTip);

  // value labels
  barG.selectAll('.bar-label').data(entries, d=>d[0]).join('text')
    .attr('class','bar-label').attr('text-anchor','middle')
    .attr('x', d=>xBar(d[0])+xBar.bandwidth()/2)
    .transition().duration(350)
    .attr('y', d=>yBar(d[1])-3)
    .text(d=>m.fmt(d[1]));

  // focus overlay
  if (focByD) {
    barG.selectAll('.bar-focus').data(entries, d=>d[0]).join('rect')
      .attr('class','bar-focus').attr('rx',3)
      .attr('x',d=>xBar(d[0])).attr('width',xBar.bandwidth())
      .transition().duration(350)
      .attr('y',d=>yBar(focByD.get(d[0])||0))
      .attr('height',d=>bh-yBar(focByD.get(d[0])||0))
      .attr('fill',d=>colorScale(state.metric==='avgPrice'?(focByD.get(d[0])||0):50000))
      .attr('opacity',0.9);
  } else { barG.selectAll('.bar-focus').remove(); }
}

function highlightBarDistrict(district) {
  barG && barG.selectAll('.bar-rect')
    .classed('selected', d=>d[0]===district)
    .classed('dimmed',   d=>district && d[0]!==district);
}

// ── TREND CHART (dual-line + crosshair + annotation) ──────────────────────
const tm = {top:12, right:15, bottom:36, left:52};
let trendG, xT, yT, brushObj;
const trendSvg = d3.select('#trend');

function initTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth-24, h = el.parentElement.clientHeight-50;
  trendSvg.attr('viewBox',`0 0 ${w} ${h}`);
  const tw = w-tm.left-tm.right, th = h-tm.top-tm.bottom;
  trendG = trendSvg.append('g').attr('transform',`translate(${tm.left},${tm.top})`);
  trendG.append('g').attr('class','x-axis axis').attr('transform',`translate(0,${th})`);
  trendG.append('g').attr('class','y-axis axis');
  trendG.append('g').attr('class','grid');
  trendG.append('path').attr('class','trend-line trend-line-all');
  trendG.append('path').attr('class','trend-line').attr('stroke','#e53935');
  trendG.append('line').attr('class','crosshair-line').attr('y1',0).attr('y2',th).style('opacity',0);
  trendG.append('circle').attr('class','crosshair-dot').attr('r',4).style('opacity',0);
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
  // crosshair overlay
  trendG.append('rect').attr('width',tw).attr('height',th).attr('fill','none').attr('pointer-events','all')
    .on('mousemove', function(e) { onTrendHover(e, tw, th); })
    .on('mouseout', () => {
      trendG.select('.crosshair-line').style('opacity',0);
      trendG.select('.crosshair-dot').style('opacity',0);
      hideTip();
    });
}

function updateTrend() {
  const el = document.getElementById('trend');
  const w = el.parentElement.clientWidth-24, h = el.parentElement.clientHeight-50;
  const tw = w-tm.left-tm.right, th = h-tm.top-tm.bottom;
  const allFiltered = applyFilters(allData, {skipDistrict:true});
  const distFiltered = state.district ? applyFilters(allData) : null;

  const rollup = data => [...d3.rollup(data, v=>d3.mean(v,d=>d.price), d=>d.tradeTime).entries()]
    .sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>({t:d3.timeParse('%Y-%m')(k),v}));

  const ptsAll  = rollup(allFiltered);
  const ptsDist = distFiltered ? rollup(distFiltered) : [];
  if (!ptsAll.length) return;

  xT = d3.scaleTime().domain(d3.extent(ptsAll,d=>d.t)).range([0,tw]);
  const yMax = d3.max([...ptsAll,...ptsDist], d=>d.v) * 1.15;
  yT = d3.scaleLinear().domain([0, yMax]).range([th,0]);

  trendG.select('.x-axis').call(d3.axisBottom(xT).ticks(6).tickFormat(d3.timeFormat('%Y')));
  trendG.select('.y-axis').call(d3.axisLeft(yT).ticks(4).tickFormat(d=>(d/1000).toFixed(0)+'k'));
  trendG.select('.grid').call(d3.axisLeft(yT).ticks(4).tickSize(-tw).tickFormat(''));

  const line = pts => d3.line().x(d=>xT(d.t)).y(d=>yT(d.v)).curve(d3.curveMonotoneX)(pts);
  trendG.select('.trend-line-all').attr('d', line(ptsAll)).style('opacity', state.district ? 1 : 0);
  trendG.select('.trend-line[stroke="#e53935"]')
    .attr('d', line(ptsDist.length ? ptsDist : ptsAll))
    .attr('stroke', state.district ? '#e53935' : '#3949ab');

  // dots
  trendG.selectAll('.tdot').data(ptsDist.length ? ptsDist : ptsAll).join('circle').attr('class','tdot')
    .attr('cx',d=>xT(d.t)).attr('cy',d=>yT(d.v)).attr('r',2.5)
    .attr('fill', state.district ? '#e53935' : '#3949ab').attr('opacity',0.7)
    .on('mouseover',(e,d)=>{ showTip(e,`${d3.timeFormat('%Y年%m月')(d.t)}<br>均价 ${Math.round(d.v).toLocaleString()} 元/㎡`); })
    .on('mousemove',moveTip).on('mouseout',hideTip);
}

function onTrendHover(e, tw, th) {
  if (!xT || !yT) return;
  const [mx] = d3.pointer(e);
  if (mx < 0 || mx > tw) return;
  const date = xT.invert(mx);
  const fmt = d3.timeFormat('%Y-%m');
  const key = fmt(date);
  const data = applyFilters(allData, {skipDistrict:true});
  const byM = d3.rollup(data, v=>d3.mean(v,d=>d.price), d=>d.tradeTime);
  const keys = [...byM.keys()].sort();
  const closest = keys.reduce((a,b) => Math.abs(b.localeCompare(key)) < Math.abs(a.localeCompare(key)) ? b : a, keys[0]);
  if (!closest) return;
  const val = byM.get(closest);
  const cx = xT(d3.timeParse('%Y-%m')(closest)), cy = yT(val);
  trendG.select('.crosshair-line').attr('x1',cx).attr('x2',cx).style('opacity',1);
  trendG.select('.crosshair-dot').attr('cx',cx).attr('cy',cy).style('opacity',1);
  showTip(e, `${closest.replace('-','年')}月<br>均价 <b>${Math.round(val).toLocaleString()}</b> 元/㎡`);
}

// ── NARRATIVE PANEL ────────────────────────────────────────────────────────
let storyStep = 0;
const STEPS = [
  {
    title: '步骤 1/5：全局概览',
    text: '北京房价由什么决定？先看全景：黄色为低价区，深紫色为高价区。西城与东城的均价遥遥领先——但为什么？让我们深入探索。',
    insight: null,
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgPrice'});
      leafMap.setView([39.95,116.4], 10);
      d3.select('#metric-select').property('value','avgPrice');
    }
  },
  {
    title: '步骤 2/5：核心区的"老破小"',
    text: '西城与东城为何这么贵？地图上紫色点代表高价房源。但看右侧柱状图——这些高价区的套均面积只有 60–80 ㎡！',
    insight: '💡 <b>洞察：</b>核心区的价值大多来自地段，而非完全取决于居住品质。这就是"老破小"现象——小面积、无电梯，却因地段溢价而单价极高。',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgSquare'});
      leafMap.setView([39.91,116.38], 12);
      d3.select('#metric-select').property('value','avgSquare');
    }
  },
  {
    title: '步骤 3/5：近郊的改善型住宅',
    text: '将视线转移到五环外的大兴与房山。这里面积普遍 88–100 ㎡，电梯房比例高，但单价反而更低。',
    insight: '💡 <b>洞察：</b>近郊是"改善型住宅"的主战场——有更大的面积和更好的配套。',
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgSquare'});
      leafMap.setView([39.75,116.25], 12);
      d3.select('#metric-select').property('value','avgSquare');
    }
  },
  {
    title: '步骤 4/5：自由探索',
    text: '两大驱动力：地段（核心区）、改善需求（近郊）。导览结束，所有工具已解锁。',
    insight: null,
    action: () => {
      Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:500, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null, metric:'avgPrice'});
      leafMap.setView([39.95,116.4], 10);
      d3.select('#metric-select').property('value','avgPrice');
    }
  }
];

function goToStep(n) {
  storyStep = n;
  state.storyStep = n;
  const s = STEPS[n];
  document.getElementById('step-indicator').textContent = `${n+1} / ${STEPS.length}`;
  document.getElementById('story-title').textContent = s.title;
  document.getElementById('story-text').textContent  = s.text;
  document.getElementById('story-insight').innerHTML = s.insight
    ? `<div class="insight-card">${s.insight}</div>` : '';
  document.getElementById('prev-btn').disabled = n === 0;
  document.getElementById('next-btn').disabled = n === STEPS.length-1;
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === n);
    dot.classList.toggle('done',   i < n);
  });
  s.action();
  resetControls();
  updateAll();
}

// story panel open/close
document.getElementById('story-close-btn').addEventListener('click', () => {
  document.getElementById('story-panel').style.display = 'none';
  document.getElementById('story-toggle-btn').style.display = '';
});
document.getElementById('story-toggle-btn').addEventListener('click', () => {
  document.getElementById('story-panel').style.display = '';
  document.getElementById('story-toggle-btn').style.display = 'none';
});
document.querySelectorAll('.step-dot').forEach(dot => {
  dot.addEventListener('click', () => goToStep(+dot.dataset.step));
});
document.getElementById('prev-btn').addEventListener('click', () => { if (storyStep > 0) goToStep(--storyStep); });
document.getElementById('next-btn').addEventListener('click', () => { if (storyStep < STEPS.length-1) goToStep(++storyStep); });

// keyboard navigation
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowRight' && storyStep < STEPS.length-1) goToStep(++storyStep);
  if (e.key === 'ArrowLeft'  && storyStep > 0)              goToStep(--storyStep);
});

// ── PANEL COLLAPSE ─────────────────────────────────────────────────────────
document.querySelectorAll('.panel-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const wrap = document.getElementById(btn.dataset.target);
    const collapsed = wrap.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▶' : '▼';
  });
});

// ── CONTROLS & INIT ────────────────────────────────────────────────────────
function updateAll() { updateMapLayer(); updateBar(); updateTrend(); }

function resetControls() {
  priceSlider && priceSlider.set([state.priceMin, state.priceMax]);
  areaSlider  && areaSlider.set([state.areaMin,  state.areaMax]);
  d3.select('#subway-only').property('checked', state.subway);
  d3.select('#elevator-only').property('checked', state.elevator);
  d3.select('#reno-filter').property('value', state.renovation);
  trendG && trendG.select('.brush').call(brushObj.move, null);
}

let priceSlider, areaSlider;
function initSliders() {
  priceSlider = noUiSlider.create(document.getElementById('price-slider'), {
    start:[5000,150000], connect:true, range:{min:5000,max:150000}, step:1000,
    format:{to:v=>Math.round(v), from:v=>+v}
  });
  priceSlider.on('update', vals => {
    state.priceMin=+vals[0]; state.priceMax=+vals[1];
    d3.select('#price-display').text(`${(+vals[0]).toLocaleString()} – ${(+vals[1]).toLocaleString()}`);
  });
  priceSlider.on('change', () => updateAll());

  areaSlider = noUiSlider.create(document.getElementById('area-slider'), {
    start:[20,350], connect:true, range:{min:10,max:400}, step:5,
    format:{to:v=>Math.round(v), from:v=>+v}
  });
  areaSlider.on('update', vals => {
    state.areaMin=+vals[0]; state.areaMax=+vals[1];
    d3.select('#area-display').text(`${vals[0]} – ${vals[1]}`);
  });
  areaSlider.on('change', () => updateAll());
}

d3.select('#subway-only').on('change',  function(){ state.subway=this.checked;    updateAll(); });
d3.select('#elevator-only').on('change',function(){ state.elevator=this.checked;  updateAll(); });
d3.select('#reno-filter').on('change',  function(){ state.renovation=+this.value; updateAll(); });
d3.select('#metric-select').on('change',function(){ state.metric=this.value;      updateBar(); });
d3.select('#brush-btn').on('click', toggleBrush);
d3.select('#reset-btn').on('click', () => {
  Object.assign(state, {district:null, priceMin:5000, priceMax:150000, areaMin:20, areaMax:350, subway:false, elevator:false, renovation:0, timeStart:null, timeEnd:null, brushBounds:null});
  state.metric='avgPrice'; d3.select('#metric-select').property('value','avgPrice');
  if (brushMode) toggleBrush();
  resetControls(); updateAll();
});

d3.json('data/housing.json').then(data => {
  allData = data;
  initSliders();
  initLeafletMap();
  initBar();
  initTrend();
  goToStep(0);
});
