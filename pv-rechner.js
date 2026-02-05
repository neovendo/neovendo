(() => {
  // --- Guard: Wenn Rechner nicht auf der Seite ist, abbrechen ---
  const donut1El = document.getElementById("donut1");
  if (!donut1El) return;

  // --- Center text plugin (für % in Donut-Mitte) ---
  const centerTextPlugin = {
    id: "centerTextPlugin",
    afterDraw(chart, args, opts) {
      const meta = chart.getDatasetMeta(0);
      if (!meta?.data?.length) return;
      const { ctx } = chart;
      const { x, y } = meta.data[0];
      const text = opts?.text ?? "";
      const fontSize = opts?.fontSize ?? 34;

      ctx.save();
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.fillStyle = opts?.color ?? "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y);
      ctx.restore();
    },
  };

  // Chart.js global register
  if (window.Chart) {
    window.Chart.register(centerTextPlugin);
  } else {
    console.error("Chart.js nicht geladen.");
    return;
  }

  // --- Helpers ---
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const r0 = (n) => Math.round(n);

  const ORI_FACTOR = {
    sued: 0.93,
    ost: 0.85,
    west: 0.85,
    suedost: 0.89,
    suedwest: 0.89,
    nord: 0.65,
  };

  function calculate({
    annualConsumptionKWh,
    pvPowerKWp,
    orientation,
    batteryKWh,
    electricityPrice,
    feedInTariff,
  }) {
    const orientationFactor = ORI_FACTOR[orientation] ?? 0.93;

    // PV-Jahresertrag (einfach)
    const specificYield = 1000; // kWh/kWp/Jahr
    const pvProduction = pvPowerKWp * specificYield * orientationFactor;

    // Eigenverbrauchsanteil (Heuristik - auf Screenshot getuned)
    const consumptionToPv = pvProduction > 0 ? annualConsumptionKWh / pvProduction : 0;
    const selfConsumptionShare = clamp(
      0.32 + 0.018 * batteryKWh + 0.12 * Math.min(1, consumptionToPv),
      0.15,
      0.95
    );

    const selfConsumptionKWh = pvProduction * selfConsumptionShare;
    const autarkyShare = annualConsumptionKWh > 0 ? selfConsumptionKWh / annualConsumptionKWh : 0;

    const gridPurchaseKWh = Math.max(0, annualConsumptionKWh - selfConsumptionKWh);
    const exportKWh = Math.max(0, pvProduction - selfConsumptionKWh);

    const costWithoutPV = annualConsumptionKWh * electricityPrice;
    const remainingGridCost = gridPurchaseKWh * electricityPrice;
    const revenueFromExport = exportKWh * feedInTariff;
    const costWithPV = remainingGridCost - revenueFromExport;
    const savings = costWithoutPV - costWithPV;

    // Splits für Charts
    const batteryLoadShare = clamp(0.15 + 0.012 * batteryKWh, 0.15, 0.55);
    const batteryDischargeToLoadKWh = selfConsumptionKWh * batteryLoadShare;
    const directUseToLoadKWh = Math.max(0, selfConsumptionKWh - batteryDischargeToLoadKWh);

    const roundTripEff = 0.9;
    const pvToBatteryChargeKWh = batteryDischargeToLoadKWh / roundTripEff;
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
      costWithPV,
      selfConsumptionKWh,
    };
  }

  // --- DOM ---
  const byId = (id) => document.getElementById(id);

  const consRange = byId("consRange"), consNum = byId("consNum");
  const pvRange = byId("pvRange"), pvNum = byId("pvNum");
  const oriSel = byId("oriSel");
  const batRange = byId("batRange"), batNum = byId("batNum");
  const priceRange = byId("priceRange"), priceNum = byId("priceNum");
  const feedRange = byId("feedRange"), feedNum = byId("feedNum");

  const k_cost_wo = byId("k_cost_wo");
  const k_save = byId("k_save");
  const k_rest = byId("k_rest");
  const k_sell = byId("k_sell");
  const k_cost_mit = byId("k_cost_mit");

  // --- Charts init ---
  const donut1 = new Chart(byId("donut1"), {
    type: "doughnut",
    data: {
      labels: ["Direktverbrauch", "Batterieladung", "Netzeinspeisung"],
      datasets: [{ data: [1, 1, 1], borderWidth: 0 }],
    },
    options: {
      cutout: "70%",
      plugins: {
        legend: { position: "bottom" },
        centerTextPlugin: { text: "0%", fontSize: 34 },
      },
    },
  });

  const donut2 = new Chart(byId("donut2"), {
    type: "doughnut",
    data: {
      labels: ["Direktverbrauch", "Batterieentladung", "Netzbezug"],
      datasets: [{ data: [1, 1, 1], borderWidth: 0 }],
    },
    options: {
      cutout: "70%",
      plugins: {
        legend: { position: "bottom" },
        centerTextPlugin: { text: "0%", fontSize: 34 },
      },
    },
  });

  const barChart = new Chart(byId("barChart"), {
    type: "bar",
    data: {
      labels: ["Stromkosten"],
      datasets: [
        { label: "ohne PV", data: [0] },
        { label: "mit PV", data: [0] },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { position: "bottom" } },
    },
  });

  function getState() {
    return {
      annualConsumptionKWh: Number(consNum.value),
      pvPowerKWp: Number(pvNum.value),
      orientation: oriSel.value,
      batteryKWh: Number(batNum.value),
      electricityPrice: Number(priceNum.value),
      feedInTariff: Number(feedNum.value),
    };
  }

  function render() {
    const m = calculate(getState());

    k_cost_wo.textContent = r0(m.costWithoutPV);
    k_save.textContent = r0(m.savings);
    k_rest.textContent = r0(m.remainingGridCost);
    k_sell.textContent = r0(m.revenueFromExport);
    k_cost_mit.textContent = r0(m.costWithPV);

    donut1.data.datasets[0].data = [
      Math.max(0, m.pvDirectUseKWh),
      Math.max(0, m.pvToBatteryChargeKWh),
      Math.max(0, m.pvExportKWh),
    ];
    donut1.options.plugins.centerTextPlugin.text = `${r0(m.selfConsumptionShare * 100)}%`;
    donut1.update();

    donut2.data.datasets[0].data = [
      Math.max(0, m.directUseToLoadKWh),
      Math.max(0, m.batteryDischargeToLoadKWh),
      Math.max(0, m.gridPurchaseKWh),
    ];
    donut2.options.plugins.centerTextPlugin.text = `${r0(m.autarkyShare * 100)}%`;
    donut2.update();

    barChart.data.datasets[0].data = [m.costWithoutPV];
    barChart.data.datasets[1].data = [m.costWithPV];
    barChart.update();
  }

  function bindPair(rangeEl, numEl) {
    const sync = (fromRange) => {
      if (fromRange) numEl.value = rangeEl.value;
      else rangeEl.value = numEl.value;
      render();
    };
    rangeEl.addEventListener("input", () => sync(true));
    numEl.addEventListener("input", () => sync(false));
  }

  bindPair(consRange, consNum);
  bindPair(pvRange, pvNum);
  bindPair(batRange, batNum);
  bindPair(priceRange, priceNum);
  bindPair(feedRange, feedNum);

  oriSel.addEventListener("change", render);

  // Initial render
  render();
})();
