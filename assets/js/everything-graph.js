(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    const EverythingGraph = factory(require("d3"));
    module.exports = { EverythingGraph };
  } else {
    root.EverythingGraph = factory(root.d3);
  }
})(typeof self !== "undefined" ? self : this, function(d3) {
  if (!d3) {
    throw new Error("D3 is required for EverythingGraph");
  }

  class EverythingGraph {
    // Force axis text and tick color for visibility (moved inside render method)
    constructor(options = {}) {
      this.d3 = options.d3 || d3;
      this.document = options.document || (typeof document !== "undefined" ? document : null);
      this.window = options.window || (typeof window !== "undefined" ? window : null);

      if (options.fetchFn) {
        this.fetchFn = options.fetchFn;
      } else if (this.window && this.window.fetch) {
        this.fetchFn = this.window.fetch.bind(this.window);
      } else if (typeof fetch !== "undefined") {
        this.fetchFn = (...args) => fetch(...args);
      } else {
        this.fetchFn = null;
      }

      this.data = {};
      this.markers = [];
      this.government = { government_periods: [], prime_ministers: [] };
      this.selectedDatasets = new Set();
      this.mode = "relative";
      this.dateRange = { start: null, end: null };
      this.activeMarkers = new Set();
      this.insights = new Set();
      this.datasetTrends = new Set();
      this.datasetAverages = new Set();
      // Removed datasetCorrelation and datasetDivergence
      this.features = new Set(["party-backgrounds", "pm-faces"]);

      this.colors = this.d3.scaleOrdinal(this.d3.schemeCategory10);
      this.margin = { top: 65, right: 80, bottom: 30, left: 50 };
      this.width = null; // Will be set dynamically
      this.height = 500 - this.margin.top - this.margin.bottom;

      // Party colors loaded from YAML (via JSON)
      this.partyColors = null;
    }

    setupResizeListener() {
      if (!this.document) return;
      const containerEl = this.document.getElementById("timeline-chart");
      if (!containerEl) return;
      const resizeHandler = () => {
        const containerWidth = containerEl.clientWidth;
        // Minimum width fallback
        this.width = Math.max(containerWidth - this.margin.left - this.margin.right, 320);
        this.render();
      };
      this.window && this.window.addEventListener("resize", resizeHandler);
      // Initial set
      resizeHandler();
    }

    async init() {
      await Promise.all([
        this.loadPartyColors(),
        this.loadData()
      ]);
      this.setupEventListeners();
      this.setupResizeListener();
    }

    async loadPartyColors() {
      if (!this.fetchFn) return;
      try {
        // Assumes a build step converts YAML to JSON at api/party_colors.json
        const response = await this.fetchFn("api/party_colors.json");
        if (response.ok) {
          this.partyColors = await response.json();
          console.log("[EverythingGraph] Loaded partyColors:", this.partyColors);
        } else {
          console.warn("[EverythingGraph] Could not load party_colors.json, using default colors");
          this.partyColors = null;
        }
      } catch (e) {
        console.warn("[EverythingGraph] Error loading party_colors.json:", e);
        this.partyColors = null;
      }
    }

    async loadData() {
      if (!this.fetchFn) {
        console.error("Fetch API is not available");
        return;
      }

      try {
        const response = await this.fetchFn("api/data.json");

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const allData = await response.json();
        this.data = allData.datasets || {};
        this.markers = allData.markers || [];
        this.government = allData.government || { government_periods: [], prime_ministers: [] };

        this.populateDatasetTree();
        this.updateDateRange();
      } catch (error) {
        console.error("Error loading data:", error);
      }
    }

    setupEventListeners() {
      // Mode pills
      this.document.querySelectorAll(".mode-pill").forEach(btn => {
        btn.addEventListener("click", (_e) => {
          const mode = btn.getAttribute("data-mode");
          if (this.mode !== mode) {
            this.mode = mode;
            // Update pill active state
            this.document.querySelectorAll(".mode-pill").forEach(b => b.classList.remove("active-filter"));
            btn.classList.add("active-filter");
            this.render();
          }
        });
      });
      if (!this.document) return;

      // Mode radio buttons (unchanged)
      const modeRadios = this.document.querySelectorAll('input[name="mode"]');
      modeRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
          this.mode = e.target.value;
          this.render();
        });
      });

      // Dataset checkboxes (unchanged)
      this.document.addEventListener("change", (e) => {
        if (e.target.classList.contains("dataset-checkbox")) {
          const datasetId = e.target.value;
          if (e.target.checked) {
            this.selectedDatasets.add(datasetId);
          } else {
            this.selectedDatasets.delete(datasetId);
          }
          this.render();
        }
      });

      // Feature pills
      this.document.querySelectorAll(".feature-pill").forEach(btn => {
        btn.addEventListener("click", (_e) => {
          const feature = btn.getAttribute("data-feature");
          if (this.features.has(feature)) {
            this.features.delete(feature);
            btn.classList.remove("active-filter");
          } else {
            this.features.add(feature);
            btn.classList.add("active-filter");
          }
          this.render();
        });
      });

      // Marker pills
      this.document.querySelectorAll(".marker-pill").forEach(btn => {
        btn.addEventListener("click", (_e) => {
          const markerType = btn.getAttribute("data-marker");
          if (this.activeMarkers.has(markerType)) {
            this.activeMarkers.delete(markerType);
            btn.classList.remove("active-filter");
          } else {
            this.activeMarkers.add(markerType);
            btn.classList.add("active-filter");
          }
          this.render();
        });
      });

      // Timeline controls (unchanged)
      const startDate = this.document.getElementById("start-date");
      const endDate = this.document.getElementById("end-date");
      const resetBtn = this.document.getElementById("reset-timeline");

      if (startDate) {
        startDate.addEventListener("change", () => {
          this.dateRange.start = new Date(startDate.value);
          this.render();
        });
      }

      if (endDate) {
        endDate.addEventListener("change", () => {
          this.dateRange.end = new Date(endDate.value);
          this.render();
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          this.updateDateRange();
          this.render();
        });
      }

      // Insights checkboxes (unchanged)
      this.document.querySelectorAll('input[name="insights"]').forEach(checkbox => {
        checkbox.addEventListener("change", (e) => {
          const insight = e.target.value;
          if (e.target.checked) {
            this.insights.add(insight);
          } else {
            this.insights.delete(insight);
          }
          this.render();
        });
      });
    }

    populateDatasetTree() {
      if (!this.document) return;
      const treeContainer = this.document.getElementById("dataset-tree");
      if (!treeContainer) return;

      const categories = {};
      Object.keys(this.data).forEach(datasetId => {
        const dataset = this.data[datasetId];
        if (!categories[dataset.category]) {
          categories[dataset.category] = [];
        }
        categories[dataset.category].push({ id: datasetId, ...dataset });
      });

      let html = "";
      Object.keys(categories).forEach(category => {
        html += `<div class="category-group">
          <h4>${category}</h4>
          <div class="dataset-list pill-row">`;

        categories[category].forEach(dataset => {
          const selected = this.selectedDatasets.has(dataset.id);
          const trendChecked = this.datasetTrends.has(dataset.id) ? "selected" : "";
          const avgChecked = this.datasetAverages.has(dataset.id) ? "selected" : "";
          // Add source link next to pill
          const source = dataset.source || "";
          const sourceUrl = dataset.source_url || "#";
          html += `
            <div class="dataset-item-row">
              <button type="button" class="pill dataset-pill${selected ? " active-filter" : ""}" data-dataset="${dataset.id}">
                <span>${dataset.name}</span>
                <small>${dataset.unit}</small>
              </button>
              <a href="${sourceUrl}" class="dataset-source-link" target="_blank" style="margin-left: 0.5em; font-size: 0.9em;">${source ? `Source` : ""}</a>
              <div class="insight-dropdown-container">
                <select class="insight-dropdown" data-dataset-id="${dataset.id}" multiple size="1">
                  <option value="trend" ${trendChecked}>Trend Lines</option>
                  <option value="average" ${avgChecked}>Rolling Averages</option>
                </select>
              </div>
            </div>`;
        });

        html += "</div></div>";
      });

      treeContainer.innerHTML = html;

      // Add event listeners for dataset pills
      this.document.querySelectorAll(".dataset-pill").forEach(btn => {
        btn.addEventListener("click", (_e) => {
          const datasetId = btn.getAttribute("data-dataset");
          if (this.selectedDatasets.has(datasetId)) {
            this.selectedDatasets.delete(datasetId);
            btn.classList.remove("active-filter");
          } else {
            this.selectedDatasets.add(datasetId);
            btn.classList.add("active-filter");
          }
          this.render();
        });
      });

      // Per-dataset insight dropdown (unchanged)
      this.document.querySelectorAll(".insight-dropdown").forEach(dropdown => {
        dropdown.addEventListener("change", (_e) => {
          const id = dropdown.getAttribute("data-dataset-id");
          const selected = Array.from(dropdown.selectedOptions).map(opt => opt.value);
          if (selected.includes("trend")) this.datasetTrends.add(id); else this.datasetTrends.delete(id);
          if (selected.includes("average")) this.datasetAverages.add(id); else this.datasetAverages.delete(id);
          this.render();
        });
      });
    }

    updateDateRange() {
      const allDates = [];
      Object.values(this.data).forEach(dataset => {
        dataset.data.forEach(point => {
          const parsed = new Date(point.date);
          if (!isNaN(parsed.getTime())) {
            allDates.push(parsed);
          }
        });
      });

      if (allDates.length === 0) {
        const today = new Date();
        const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        this.dateRange.start = oneYearAgo;
        this.dateRange.end = today;
      } else {
        this.dateRange.start = this.d3.min(allDates);
        this.dateRange.end = this.d3.max(allDates);
      }

      if (this.document) {
        const startDateInput = this.document.getElementById("start-date");
        const endDateInput = this.document.getElementById("end-date");
        if (startDateInput) startDateInput.value = this.formatDate(this.dateRange.start);
        if (endDateInput) endDateInput.value = this.formatDate(this.dateRange.end);
      }
    }

    formatDate(date) {
      if (!date || isNaN(date.getTime())) return "";
      return date.toISOString().split("T")[0];
    }

    prepareData() {
      const prepared = [];

      this.selectedDatasets.forEach(datasetId => {
        const dataset = this.data[datasetId];
        if (!dataset) return;

        const sortedData = [...dataset.data].sort((a, b) => new Date(a.date) - new Date(b.date));
        const processedData = sortedData.map(point => ({
          date: new Date(point.date),
          value: point.value,
          abs: point.value
        })).filter(point => {
          if (this.dateRange.start && point.date < this.dateRange.start) return false;
          if (this.dateRange.end && point.date > this.dateRange.end) return false;
          return true;
        });

        if (this.mode === "relative") {
          const firstValue = processedData[0]?.value;
          if (firstValue === 0) {
            processedData.forEach(point => {
              point.value = 0;
            });
          } else if (firstValue != null) {
            processedData.forEach(point => {
              point.value = ((point.value - firstValue) / firstValue) * 100;
            });
          }
        }

        prepared.push({
          id: datasetId,
          name: dataset.name,
          unit: dataset.unit,
          data: processedData
        });
      });

      return prepared;
    }

    validateAbsoluteCompatibility(datasets) {
      const units = new Set();
      datasets.forEach(ds => {
        units.add(ds.unit);
      });
      if (units.size > 1) {
        const unitList = Array.from(units).join(", ");
        return {
          ok: false,
          message: "Select datasets with matching units for absolute mode. Units: " + unitList
        };
      }
      return { ok: true, message: "" };
    }

    render() {
      if (!this.document) return;
      const containerEl = this.document.getElementById("timeline-chart");
      if (!containerEl) return;

      containerEl.innerHTML = "";

      console.log("[EverythingGraph] render: selectedDatasets", Array.from(this.selectedDatasets));
      if (!this.dateRange.start || !this.dateRange.end) {
        this.updateDateRange();
      }

      const preparedData = this.prepareData();
      console.log("[EverythingGraph] render: preparedData", preparedData);

      let noData = false;
      let noSelection = false;
      if (this.selectedDatasets.size === 0) {
        noSelection = true;
      } else if (!preparedData.length || preparedData.every(ds => ds.data.length === 0)) {
        noData = true;
      }

      if (this.mode === "absolute" && !noSelection && !noData) {
        const compatibility = this.validateAbsoluteCompatibility(preparedData);
        if (!compatibility.ok) {
          containerEl.textContent = compatibility.message;
          this.renderInsightSummary([compatibility.message]);
          return;
        }
      }

      const container = this.d3.select(containerEl);
      container.selectAll("*").remove();

      // Defensive: if width is not set, set it now
      if (!this.width) {
        const containerWidth = containerEl.clientWidth;
        this.width = Math.max(containerWidth - this.margin.left - this.margin.right, 320);
      }
      const svg = container.append("svg")
        .attr("width", this.width + this.margin.left + this.margin.right)
        .attr("height", this.height + this.margin.top + this.margin.bottom);

      const g = svg.append("g")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

      const xScale = this.d3.scaleTime()
        .domain([this.dateRange.start, this.dateRange.end])
        .range([0, this.width]);

      const yScale = this.d3.scaleLinear()
        .range([this.height, 0]);

      // If there is data, set y domain; otherwise, use a default domain
      let yDomain = [0, 1];
      if (!noSelection && !noData) {
        const allValues = preparedData.flatMap(d => d.data.map(p => p.value));
        const ext = this.d3.extent(allValues);
        if (ext[0] != null && ext[1] != null && isFinite(ext[0]) && isFinite(ext[1]) && ext[0] !== ext[1]) {
          yDomain = ext;
        }
      }
      yScale.domain(yDomain);

      // Draw government party backgrounds
      this.drawPartyBackgrounds(g, xScale);

      // Log axis domains and rendering
      console.log("[EverythingGraph] xScale domain:", xScale.domain());
      console.log("[EverythingGraph] yScale domain:", yScale.domain());
      const xAxisG = g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${this.height})`)
        .call(this.d3.axisBottom(xScale));
      const yAxisG = g.append("g")
        .attr("class", "y-axis")
        .call(this.d3.axisLeft(yScale));
      console.log("[EverythingGraph] x-axis g:", xAxisG.node());
      console.log("[EverythingGraph] y-axis g:", yAxisG.node());

      // Only draw lines/points if there is data
      if (!noSelection && !noData) {
        const line = this.d3.line()
          .x(d => xScale(d.date))
          .y(d => yScale(d.value))
          .defined(d => d.value != null);

        preparedData.forEach((dataset, i) => {
          g.append("path")
            .datum(dataset.data)
            .attr("class", "line")
            .attr("d", line)
            .style("stroke", this.colors(i))
            .style("fill", "none")
            .style("stroke-width", 2);

          // Add hoverable points with title-based tooltips
          const points = g.append("g").attr("class", `points points-${i}`);
          points.selectAll("circle")
            .data(dataset.data)
            .join("circle")
            .attr("cx", d => xScale(d.date))
            .attr("cy", d => yScale(d.value))
            .attr("r", 3)
            .style("fill", this.colors(i))
            .style("opacity", 0.7)
            .each((d, idx, nodes) => {
              const sel = this.d3.select(nodes[idx]);
              const pct = (d.value != null && isFinite(d.value)) ? d.value.toFixed(1) + "%" : "";
              const abs = (d.abs != null && isFinite(d.abs)) ? d.abs : d.value;
              const absStr = (abs != null && isFinite(abs)) ? abs : "";
              const dateStr = this.formatDate(d.date);
              const text = this.mode === "relative"
                ? `${dataset.name} — ${dateStr}: ${absStr} (${pct})`
                : `${dataset.name} — ${dateStr}: ${absStr}`;
              sel.append("title").text(text);
            });
        });
      }

      this.drawMarkers(g, xScale);
      if (!noSelection && !noData) {
        this.applyInsights(g, preparedData, xScale, yScale);
      }
      // Legend removed: no longer calling updateLegend
      this.drawPMFaces(g, xScale);
      // Removed saveStateToURL (URL param sync)

      // Overlay message if nothing to show
      if (noSelection) {
        this.renderInsightSummary([]);
        // Overlay message in SVG
        svg.append("text")
          .attr("x", (this.width + this.margin.left + this.margin.right) / 2)
          .attr("y", (this.height + this.margin.top + this.margin.bottom) / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "#888")
          .attr("font-size", 22)
          .text("Select datasets to visualize");
      }
    }

    drawPartyBackgrounds(g, xScale) {
      if (!this.features.has("party-backgrounds") || !this.government || !this.government.government_periods) return;

      // Only use loaded partyColors from JSON
      const partyColors = this.partyColors;

      const periods = this.government.government_periods.filter(p => {
        const start = new Date(p.start_date);
        const end = new Date(p.end_date);
        return (!this.dateRange.start || end >= this.dateRange.start) &&
               (!this.dateRange.end || start <= this.dateRange.end);
      });

      const bgGroup = g.insert("g", ":first-child").attr("class", "government-backgrounds");

      periods.forEach(period => {
        const x1 = xScale(new Date(period.start_date));
        const x2 = xScale(new Date(period.end_date));
        // Use provided color or fallback to partyColors
        const fillColor = period.color || partyColors[period.party] || "#cccccc";
        bgGroup.append("rect")
          .attr("x", x1)
          .attr("y", 0)
          .attr("width", x2 - x1)
          .attr("height", this.height)
          .style("fill", fillColor)
          .style("opacity", 0.05)
          .attr("class", `government-bg government-${period.party.toLowerCase()}`);
      });
    }

    drawPMFaces(g, xScale) {
      if (!this.features.has("pm-faces") || !this.government || !this.government.prime_ministers) return;

      const pms = this.government.prime_ministers.filter(pm => {
        const date = new Date(pm.start_date);
        return (!this.dateRange.start || date >= this.dateRange.start) &&
               (!this.dateRange.end || date <= this.dateRange.end);
      });

      const pmGroup = g.append("g").attr("class", "pm-faces");
      const faceSize = 40;

      pms.forEach(pm => {
        const x = xScale(new Date(pm.start_date));
        // Slugify the PM's name: lowercase, replace spaces with hyphens
        const slug = pm.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "-");
        const imgPath = `/assets/images/prime-ministers/${slug}.jpg`;

        pmGroup.append("image")
          .attr("x", x - faceSize / 2)
          .attr("y", -faceSize - 8)
          .attr("width", faceSize)
          .attr("height", faceSize)
          .attr("href", imgPath)
          .attr("class", "pm-face")
          .style("border-radius", "50%")
          .style("clip-path", "circle(50%)")
          .append("title")
          .text(`${pm.name} (commenced ${new Date(pm.start_date).toLocaleDateString()})`);
      });
    }

    formatSuccessionDetail(detail) {
      const map = {
        "election": "Election",
        "leadership spill": "Leadership Spill",
        "succession": "Succession",
        "inheritance": "Succession"
      };
      return map[detail] || detail;
    }

    drawMarkers(g, xScale) {
      const filtered = this.markers.filter(marker =>
        this.activeMarkers.has(marker.type) &&
        (!this.dateRange.start || new Date(marker.date) >= this.dateRange.start) &&
        (!this.dateRange.end || new Date(marker.date) <= this.dateRange.end)
      );

      const positions = filtered.map(m => ({
        marker: m,
        x: xScale(new Date(m.date))
      })).sort((a, b) => a.x - b.x);

      // Assign stack levels for labels that are within proximity on x
      const proximityPx = 18; // labels within 18px horizontally will stack
      let lastX = -Infinity;
      let stack = 0;
      positions.forEach(p => {
        if (p.x - lastX < proximityPx) {
          stack += 1;
        } else {
          stack = 0;
        }
        p.stack = stack;
        lastX = p.x;
      });

      const markerGroup = g.append("g").attr("class", "markers");

      positions.forEach(p => {
        const { marker } = p;
        const x = p.x;
        const color = this.getMarkerColor();

        markerGroup.append("line")
          .attr("x1", x)
          .attr("x2", x)
          .attr("y1", 0)
          .attr("y2", this.height)
          .attr("class", `marker-line marker-${marker.type}`)
          .style("stroke", color)
          .style("stroke-width", 1)
          .style("stroke-dasharray", "3,3");

        // Place label at the bottom, stack upward if needed
        const labelY = this.height - 5 - p.stack * 12;
        markerGroup.append("text")
          .attr("x", x)
          .attr("y", labelY)
          .attr("text-anchor", "end")
          .attr("class", "marker-label")
          .style("font-size", "10px")
          .style("fill", color)
          .text(marker.name);
      });
    }

    applyInsights(g, datasets, xScale, yScale) {
      const summaries = [];
      const line = this.d3.line()
        .x(d => xScale(d.date))
        .y(d => yScale(d.value));

      // Per-dataset trend lines
      if (this.insights.has("trends") || this.datasetTrends.size > 0) {
        datasets.forEach((dataset, i) => {
          if (this.insights.has("trends") || this.datasetTrends.has(dataset.id)) {
            const trend = this.computeTrendLine(dataset.data);
            if (trend.length >= 2) {
              g.append("path")
                .datum(trend)
                .attr("class", "trend-line")
                .attr("d", line)
                .style("stroke", this.colors(i))
                .style("stroke-dasharray", "6,4")
                .style("fill", "none")
                .style("opacity", 0.7);
            }
          }
        });
      }
      // Per-dataset rolling averages
      if (this.insights.has("averages") || this.datasetAverages.size > 0) {
        datasets.forEach((dataset, i) => {
          if (this.insights.has("averages") || this.datasetAverages.has(dataset.id)) {
            const rolling = this.computeRollingAverage(dataset.data, 3);
            if (rolling.length > 1) {
              g.append("path")
                .datum(rolling)
                .attr("class", "rolling-average")
                .attr("d", line)
                .style("stroke", this.colors(i))
                .style("stroke-width", 1.5)
                .style("fill", "none")
                .style("opacity", 0.6);
            }
          }
        });
      }
      // Removed correlation and divergence summary logic

      this.renderInsightSummary(summaries);
    }

    computeTrendLine(data) {
      if (!data || data.length < 2) return [];
      const sorted = [...data].sort((a, b) => a.date - b.date);
      const xs = sorted.map(point => point.date.getTime());
      const ys = sorted.map(point => point.value);
      const n = xs.length;
      const meanX = xs.reduce((s, v) => s + v, 0) / n;
      const meanY = ys.reduce((s, v) => s + v, 0) / n;

      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (xs[i] - meanX) * (ys[i] - meanY);
        denominator += Math.pow(xs[i] - meanX, 2);
      }

      if (denominator === 0) return [];
      const slope = numerator / denominator;
      const intercept = meanY - slope * meanX;

      const firstX = xs[0];
      const lastX = xs[xs.length - 1];
      return [
        { date: new Date(firstX), value: intercept + slope * firstX },
        { date: new Date(lastX), value: intercept + slope * lastX }
      ];
    }

    computeRollingAverage(data, windowSize = 3) {
      if (!data || data.length === 0) return [];
      const sorted = [...data].sort((a, b) => a.date - b.date);
      const result = [];

      for (let i = 0; i < sorted.length; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const window = sorted.slice(start, i + 1);
        const avg = window.reduce((sum, point) => sum + point.value, 0) / window.length;
        result.push({ date: sorted[i].date, value: avg });
      }

      return result;
    }

    // Removed computeCorrelation and detectDivergence methods

    getLatestOverlap(seriesA, seriesB) {
      const mapB = new Map(seriesB.map(point => [point.date.getTime(), point]));
      const overlap = seriesA
        .filter(point => mapB.has(point.date.getTime()))
        .sort((a, b) => b.date - a.date);

      if (!overlap.length) return null;
      const latestA = overlap[0];
      return { a: latestA, b: mapB.get(latestA.date.getTime()) };
    }

    renderInsightSummary(items) {
      if (!this.document) return;
      let container = this.document.getElementById("insight-summary");
      if (!items || items.length === 0) {
        if (container) container.innerHTML = "";
        return;
      }

      if (!container) {
        container = this.document.createElement("div");
        container.id = "insight-summary";
        container.className = "insight-summary";
        const legend = this.document.getElementById("legend");
        if (legend && legend.parentNode) {
          legend.parentNode.insertBefore(container, legend.nextSibling);
        } else {
          this.document.body.appendChild(container);
        }
      }

      container.innerHTML = items.map(item => `<div class="insight-summary__item">${item}</div>`).join("");
    }

    getMarkerColor() {
      return "#000"; // All markers use black
    }

    // updateLegend removed: legend is no longer shown
  }

  return EverythingGraph;
});

if (typeof window !== "undefined" && window.document && window.EverythingGraph) {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new window.EverythingGraph();
    app.init();

    const shareButton = window.document.createElement("button");
    shareButton.textContent = "Share View";
    shareButton.className = "btn btn-primary";
    shareButton.style.position = "fixed";
    shareButton.style.bottom = "20px";
    shareButton.style.right = "20px";
    shareButton.style.zIndex = "1000";

    shareButton.addEventListener("click", () => {
      app.saveStateToURL();
      const url = window.location.href;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          alert("URL copied to clipboard!");
        });
      } else {
        prompt("Copy this URL to share:", url);
      }
    });

    window.document.body.appendChild(shareButton);
  });
}
