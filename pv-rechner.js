// --- Center Text Plugin (für % in der Donut-Mitte) ---
const centerTextPlugin = {
  id: 'centerTextPlugin',
  afterDraw(chart, args, opts) {
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;
    const {ctx} = chart;
    const {x, y} = meta.data[0];
    const text = (opts && opts.text) ? opts.text : '';
    const fontSize = (opts && opts.fontSize) ? opts.fontSize : 34;

    ctx.save();
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillStyle = (opts && opts.color) ? opts.color : '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
};

// --- Helpers ---
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const r0 = (n) => Math.round(n);
const n0 = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

const ORI = ["sued","suedost","suedwest","ost","west","nord"];
const ORI_FACTOR = { sued:0.93, ost:0.85, west:0.85, suedost:0.89, suedwest:0.89, nord:0.65 };

function calculate({annualConsumptionKWh, pvPowerKWp, orientation, batteryKWh, electricityPrice, feedInTariff}) {
  const orientationFactor = ORI_FACTOR[orientation] ?? 0.93;

  // PV-Jahresertrag (einfach)
  const specificYield = 1000; // kWh/kWp/Jahr
  const pvProduction = pvPowerKWp * specificYield * orientationFactor;

  // Eigenverbrauchsanteil (Heuristik)
  const consumptionToPv = pvProduction > 0 ? annualConsumptionKWh / pvProduction : 0;
  const baseSelfShare = clamp(
    0.32 + 0.018 * batteryKWh + 0.12 * Math.min(1, consumptionToPv),
    0.15, 0.95
  );

  // Realistische Begrenzung
  const potentialSelfUse = pvProduction * baseSelfShare;
  const selfConsumptionKWh = Math.min(annualConsumptionKWh, potentialSelfUse);
  const selfConsumptionShare = pvProduction > 0 ? selfConsumptionKWh / pvProduction : 0;
  const autarkyShare = annualConsumptionKWh > 0 ? clamp(selfConsumptionKWh / annualConsumptionKWh, 0, 1) : 0;

  const gridPurchaseKWh = Math.max(0, annualConsumptionKWh - selfConsumptionKWh);
  const exportKWh = Math.max(0, pvProduction - selfConsumptionKWh);

  const costWithoutPV = annualConsumptionKWh * electricityPrice;
  const remainingGridCost = gridPurchaseKWh * electricityPrice;
  const revenueFromExport = exportKWh * feedInTariff;
  const costWithPV = remainingGridCost - revenueFromExport;
  const savings = costWithoutPV - costWithPV;

  // Splits für Charts (Batterie nur wenn vorhanden)
  const batteryLoadShare = batteryKWh > 0 ? clamp(0.10 + 0.02 * batteryKWh, 0.10, 0.60) : 0;
  const batteryDischargeToLoadKWh = selfConsumptionKWh * batteryLoadShare;
  const directUseToLoadKWh = Math.max(0, selfConsumptionKWh - batteryDischargeToLoadKWh);

  const roundTripEff = 0.9;
  const pvToBatteryChargeKWh = batteryDischargeToLoadKWh > 0 ? batteryDischargeToLoadKWh / roundTripEff : 0;
  const pvDirectUseKWh = directUseToLoadKWh;
  const pvExportKWh = Math.max(0, pvProduction - pvDirectUseKWh - pvToBatteryChargeKWh);

  return {
    pvProduction,
    selfConsumptionShare,
    autarkyShare,
    pvDirectUseKWh,
    pvToBatteryChargeKWh,
    pvExportKWh,
    directUseToLoadKWh,
    batteryDischargeToLoadKWh,
    gridPurchaseKWh,
    costWithoutPV,
    savings,
    remainingGridCost,
    revenueFromExport,
    costWithPV
  };
}

// --- DOM ---
const el = (id) => document.getElementById(id);

const consRange = el("consRange"), consNum = el("consNum");
const pvRange = el("pvRange"), pvNum = el("pvNum");
const oriRange = el("oriRange"), oriSel = el("oriSel");
const batRange = el("batRange"), batNum = el("batNum");
const priceRange = el("priceRange"), priceNum = el("priceNum");
const feedRange = el("feedRange"), feedNum = el("feedNum");
const pdfBtn = el("pdfBtn");

// Defaults wie Screenshot
consRange.value = consNum.value = 9500;
pvRange.value = pvNum.value = 8.0;
oriSel.value = "sued"; oriRange.value = ORI.indexOf("sued");
batRange.value = batNum.value = 20.0;
priceRange.value = priceNum.value = 0.25;
feedRange.value = feedNum.value = 0.00;

function getState(){
  return {
    annualConsumptionKWh: n0(Number(consNum.value)),
    pvPowerKWp: n0(Number(pvNum.value)),
    orientation: oriSel.value,
    batteryKWh: n0(Number(batNum.value)),
    electricityPrice: n0(Number(priceNum.value)),
    feedInTariff: n0(Number(feedNum.value))
  };
}

// --- Charts init ---
Chart.register(centerTextPlugin);

const donut1 = new Chart(el("donut1"), {
  type: "doughnut",
  data: {
    labels: ["Direktverbrauch", "Batterieladung", "Netzeinspeisung"],
    datasets: [{ data: [1,1,1], borderWidth: 0 }]
  },
  options: {
    cutout: "70%",
    plugins: {
      legend: { position: "bottom" },
      centerTextPlugin: { text: "0%", fontSize: 34 }
    }
  }
});

const donut2 = new Chart(el("donut2"), {
  type: "doughnut",
  data: {
    labels: ["Direktverbrauch", "Batterieentladung", "Netzbezug"],
    datasets: [{ data: [1,1,1], borderWidth: 0 }]
  },
  options: {
    cutout: "70%",
    plugins: {
      legend: { position: "bottom" },
      centerTextPlugin: { text: "0%", fontSize: 34 }
    }
  }
});

const barChart = new Chart(el("barChart"), {
  type: "bar",
  data: {
    labels: ["Stromkosten"],
    datasets: [
      { label: "ohne PV", data: [0] },
      { label: "mit PV", data: [0] }
    ]
  },
  options: {
    indexAxis: "y",
    responsive: true,
    plugins: {
      legend: { position: "bottom" },
      title: { display: false }
    }
  }
});

function render(){
  const s = getState();
  const m = calculate(s);

  // KPIs
  el("k_cost_wo").textContent  = r0(m.costWithoutPV);
  el("k_save").textContent     = r0(m.savings);
  el("k_rest").textContent     = r0(m.remainingGridCost);
  el("k_sell").textContent     = r0(m.revenueFromExport);
  el("k_cost_mit").textContent = r0(m.costWithPV);

  // Notes
  el("n_pv").textContent = r0(m.pvProduction);
  el("n_ev").textContent = r0(m.selfConsumptionShare * m.pvProduction);

  // Donut 1: Eigenverbrauchsanteil (PV-seitig)
  donut1.data.datasets[0].data = [
    Math.max(0, m.pvDirectUseKWh),
    Math.max(0, m.pvToBatteryChargeKWh),
    Math.max(0, m.pvExportKWh),
  ];
  donut1.options.plugins.centerTextPlugin.text = `${r0(m.selfConsumptionShare * 100)}%`;
  donut1.update();

  // Donut 2: Autarkie (Last-seitig)
  donut2.data.datasets[0].data = [
    Math.max(0, m.directUseToLoadKWh),
    Math.max(0, m.batteryDischargeToLoadKWh),
    Math.max(0, m.gridPurchaseKWh),
  ];
  donut2.options.plugins.centerTextPlugin.text = `${r0(m.autarkyShare * 100)}%`;
  donut2.update();

  // Bar
  barChart.data.datasets[0].data = [m.costWithoutPV];
  barChart.data.datasets[1].data = [m.costWithPV];
  barChart.update();
}

// --- Bindings (Range <-> Number sync) ---
function bindPair(rangeEl, numEl, onChange){
  const min = Number(rangeEl.min);
  const max = Number(rangeEl.max);
  const step = Number(rangeEl.step) || 1;

  const clampToRange = (v) => {
    const raw = clamp(v, min, max);
    const snapped = Math.round(raw / step) * step;
    return Number(snapped.toFixed(4));
  };

  const sync = (fromRange) => {
    if (fromRange) {
      numEl.value = rangeEl.value;
    } else {
      const next = clampToRange(Number(numEl.value));
      numEl.value = next;
      rangeEl.value = next;
    }
    onChange();
  };
  rangeEl.addEventListener("input", () => sync(true));
  numEl.addEventListener("input", () => sync(false));
}

bindPair(consRange, consNum, render);
bindPair(pvRange, pvNum, render);
bindPair(batRange, batNum, render);
bindPair(priceRange, priceNum, render);
bindPair(feedRange, feedNum, render);

oriRange.addEventListener("input", () => {
  oriSel.value = ORI[Number(oriRange.value)] ?? "sued";
  render();
});
oriSel.addEventListener("change", () => {
  oriRange.value = ORI.indexOf(oriSel.value);
  render();
});

// First render
render();

if (pdfBtn) {
  pdfBtn.addEventListener("click", () => {
    window.print();
  });
}
