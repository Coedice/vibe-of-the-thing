(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    const WellbeingIndexGraph = factory(require("d3"));
    module.exports = { WellbeingIndexGraph };
  } else {
    root.WellbeingIndexGraph = factory(root.d3);
  }
})(typeof self !== "undefined" ? self : this, function(d3) {
  if (!d3) {
    throw new Error("D3 is required for WellbeingIndexGraph");
  }

  class WellbeingIndexGraph {
    constructor(options = {}) {
      this.d3 = options.d3 || d3;
      this.document = options.document || (typeof document !== "undefined" ? document : null);
      this.window = options.window || (typeof window !== "undefined" ? window : null);
      this.fetchFn = this.initializeFetch(options.fetchFn);

      this.statistics = {};
      this.government = { government_periods: [], prime_ministers: [] };
      this.partyColors = {};
      
      this.dateRangeStart = new Date("2005-01-01");
      this.dateRangeStart.setDate(1);
      this.dateRangeEnd = new Date();
      this.dateRangeEnd.setMonth(this.dateRangeEnd.getMonth() - 1);
      this.dateRangeEnd.setDate(1);
      
      this.margin = { top: 60, right: 120, bottom: 110, left: 60 };
      this.width = null;
      this.height = 600 - this.margin.top - this.margin.bottom;

      this.componentWeightings = {};
      this.componentColors = {};

      this.styles = {
        area: { opacity: 0.7 },
        line: { stroke: "#000", strokeWidth: 3, opacity: 1, fill: "none" },
        dot: { fill: "#000", stroke: "#fff", strokeWidth: 1.5, radius: 4 },
        axis: { fontSize: "12px", fill: "#666" },
        backgroundColor: { opacity: 0.25 }
      };
    }

    initializeFetch(customFetch) {
      if (customFetch) return customFetch;
      if (this.window?.fetch) return this.window.fetch.bind(this.window);
      if (typeof fetch !== "undefined") return (...args) => fetch(...args);
      return null;
    }

    setupResizeListener() {
      if (!this.document) return;
      const containerEl = this.document.getElementById("timeline-chart");
      if (!containerEl) return;
      const resizeHandler = () => {
        const containerWidth = containerEl.clientWidth;
        this.width = Math.max(containerWidth - this.margin.left - this.margin.right, 320);
        this.render();
      };
      this.window && this.window.addEventListener("resize", resizeHandler);
      resizeHandler();
    }

    async init() {
      await this.loadData();
      this.setupWeightingControls();
      this.setupDateRangeInputs();
      this.setupResizeListener();
      this.renderWeightingSummary();
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
        this.statistics = allData.statistics || {};
        this.government = allData.government || [];
        this.partyColors = allData.party_colors || {};

        this.componentWeightings = {};
        this.componentColors = {};
        Object.entries(this.statistics).forEach(([id, stat]) => {
          if (stat.wellbeing) {
            const initialWeight = Number(stat.wellbeing.weight);
            const rawWeight = Number.isFinite(initialWeight)
              ? (initialWeight <= 1 ? initialWeight * 100 : initialWeight)
              : 50;

            this.componentWeightings[id] = {
              rawWeight,
              weight: 0,
              inverted: stat.wellbeing.inverted || false,
              name: stat.wellbeing.name || stat.name || id
            };
            this.componentColors[id] = stat.wellbeing.color || "#888888";
          }
        });

        this.normalizeWeights();
        this.calculateGlobalRanges();

        console.log("[WellbeingIndexGraph] Loaded statistics:", Object.keys(this.statistics));
        console.log("[WellbeingIndexGraph] Component weightings:", Object.keys(this.componentWeightings));
        console.log("[WellbeingIndexGraph] Global ranges:", this.statisticRanges);
      } catch (error) {
        console.error("Error loading data:", error);
      }
    }

    calculateGlobalRanges() {
      this.statisticRanges = {};
      Object.keys(this.componentWeightings).forEach(id => {
        const stat = this.statistics[id];
        if (stat && stat.data && Array.isArray(stat.data)) {
          const values = stat.data
            .map(d => d.value)
            .filter(v => v != null && !isNaN(v));
          if (values.length > 0) {
            this.statisticRanges[id] = {
              min: Math.min(...values),
              max: Math.max(...values)
            };
          }
        }
      });
    }

    setupWeightingControls() {
      if (!this.document) return;
      const container = this.document.getElementById("weightings-container");
      if (!container) return;

      container.innerHTML = "";

      Object.entries(this.componentWeightings).forEach(([id, config]) => {
        const stat = this.statistics[id];
        if (!stat) return;

        const color = this.componentColors[id] || "#888888";
        const wrapper = this.document.createElement("div");
        wrapper.className = "weighting-control";
        wrapper.innerHTML = `
          <label for="weight-${id}" style="color: ${color}">${config.name}</label>
          <input type="range" id="weight-${id}" min="0" max="100" value="${config.rawWeight}" data-factor="${id}" style="accent-color: ${color}">
          <span class="weight-value">${config.rawWeight.toFixed(0)}%</span>
        `;
        container.appendChild(wrapper);

        const input = wrapper.querySelector(`#weight-${id}`);
        input.addEventListener("input", (e) => {
          this.componentWeightings[id].rawWeight = parseFloat(e.target.value);
          this.normalizeWeights();
          this.renderWeightingSummary();
          wrapper.querySelector(".weight-value").textContent = `${this.componentWeightings[id].rawWeight.toFixed(0)}%`;
          this.render();
        });
      });
    }

    normalizeWeights() {
      const total = Object.values(this.componentWeightings).reduce((sum, c) => sum + c.rawWeight, 0);
      if (total > 0) {
        Object.values(this.componentWeightings).forEach(c => {
          c.weight = c.rawWeight / total;
        });
      }
    }

    renderWeightingSummary() {
      if (!this.document) return;
      const summary = this.document.getElementById("weighting-summary");
      if (!summary) return;

      summary.innerHTML = "";

      const data = Object.entries(this.componentWeightings).map(([id, c]) => ({
        id,
        name: c.name,
        weight: c.weight,
        color: this.componentColors[id] || "#888888"
      }));

      const size = 200;
      const svg = this.d3.select(summary).append("svg")
        .attr("width", size)
        .attr("height", size)
        .append("g")
        .attr("transform", `translate(${size / 2},${size / 2})`);

      const pie = this.d3.pie().value(d => d.weight).sort(null);
      const arc = this.d3.arc().innerRadius(0).outerRadius(size / 2 - 20);

      svg.selectAll("path")
        .data(pie(data))
        .enter()
        .append("path")
        .attr("d", arc)
        .style("fill", d => d.data.color)
        .style("stroke", "#fff")
        .style("stroke-width", 2);

      // Add labels
      svg.selectAll("text")
        .data(pie(data))
        .enter()
        .append("text")
        .attr("transform", d => `translate(${arc.centroid(d)})`)
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("fill", "#fff")
        .style("pointer-events", "none")
        .text(d => `${(d.data.weight * 100).toFixed(0)}%`);
    }

    setupDateRangeInputs() {
      if (!this.document) return;
      
      this.refreshDateInputs();

      const sliderMin = this.document.getElementById("slider-min");
      const sliderMax = this.document.getElementById("slider-max");
      
      if (!sliderMin || !sliderMax) return;

      const updateFromSlider = () => {
        const minVal = parseInt(sliderMin.value);
        const maxVal = parseInt(sliderMax.value);
        
        if (minVal > maxVal) {
          sliderMin.value = maxVal;
        }
        
        this.dateRangeStart = this.monthIndexToDate(parseInt(sliderMin.value));
        this.dateRangeEnd = this.monthIndexToDate(parseInt(sliderMax.value));
        
        this.updateDateLabels();
        this.render();
      };

      sliderMin.addEventListener("input", updateFromSlider);
      sliderMax.addEventListener("input", updateFromSlider);
    }

    refreshDateInputs() {
      if (!this.document) return;
      
      const sliderMin = this.document.getElementById("slider-min");
      const sliderMax = this.document.getElementById("slider-max");
      
      if (!sliderMin || !sliderMax) return;

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const lastMonthIndex = this.dateToMonthIndex(lastMonth);

      const federationDate = new Date(1901, 0, 1);
      const minIndex = this.dateToMonthIndex(federationDate);

      const earliestDataDate = this.getEarliestDataDate();
      const actualMinIndex = earliestDataDate ? this.dateToMonthIndex(earliestDataDate) : minIndex;

      this.dateRangeStart = this.monthIndexToDate(actualMinIndex);

      sliderMin.min = actualMinIndex;
      sliderMax.min = actualMinIndex;
      sliderMin.max = lastMonthIndex;
      sliderMax.max = lastMonthIndex;

      sliderMin.value = actualMinIndex;
      sliderMax.value = lastMonthIndex;

      this.dateRangeStart = this.monthIndexToDate(actualMinIndex);
      this.dateRangeEnd = this.monthIndexToDate(lastMonthIndex);

      this.updateDateLabels();
    }

    updateDateLabels() {
      if (!this.document) return;
      const sliderMin = this.document.getElementById("slider-min");
      const sliderMax = this.document.getElementById("slider-max");
      const fromLabel = this.document.getElementById("date-from-label");
      const toLabel = this.document.getElementById("date-to-label");
      
      if (fromLabel) {
        fromLabel.textContent = this.formatDateForInput(this.dateRangeStart);
        if (sliderMin) {
          const percent = (parseInt(sliderMin.value) - parseInt(sliderMin.min)) / (parseInt(sliderMin.max) - parseInt(sliderMin.min));
          fromLabel.style.left = `${percent * 100}%`;
        }
      }
      if (toLabel) {
        toLabel.textContent = this.formatDateForInput(this.dateRangeEnd);
        if (sliderMax) {
          const percent = (parseInt(sliderMax.value) - parseInt(sliderMax.min)) / (parseInt(sliderMax.max) - parseInt(sliderMax.min));
          toLabel.style.left = `${percent * 100}%`;
        }
      }
    }

    dateToMonthIndex(date) {
      return date.getFullYear() * 12 + date.getMonth();
    }

    monthIndexToDate(index) {
      const year = Math.floor(index / 12);
      const month = index % 12;
      return new Date(year, month, 1);
    }

    getEarliestDataDate() {
      let earliestDate = null;
      Object.entries(this.componentWeightings).forEach(([id, config]) => {
        if (config.weight > 0) {
          const stat = this.statistics[id];
          if (stat && stat.data && Array.isArray(stat.data) && stat.data.length > 0) {
            const firstPoint = stat.data[0];
            const date = this.parseDate(firstPoint.date);
            if (!earliestDate || date.getTime() > earliestDate.getTime()) {
              earliestDate = date;
            }
          }
        }
      });
      return earliestDate;
    }

    getComponentIds() {
      return Object.keys(this.componentWeightings).filter(id => this.statistics[id]);
    }

    parseDate(dateStr) {
      const match = dateStr.match(/^(\d{4})-(\d{2})$/);
      if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, 1);
      }
      return new Date(dateStr);
    }

    formatDateForInput(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      return `${year}-${month}`;
    }

    getDataInRange(statisticId) {
      const stat = this.statistics[statisticId];
      if (!stat || !stat.data) return [];

      const startYear = this.dateRangeStart.getFullYear();
      const startMonth = this.dateRangeStart.getMonth();
      const endYear = this.dateRangeEnd.getFullYear();
      const endMonth = this.dateRangeEnd.getMonth();

      const rawData = stat.data
        .filter(d => {
          const date = this.parseDate(d.date);
          const dYear = date.getFullYear();
          const dMonth = date.getMonth();
          return (dYear > startYear || (dYear === startYear && dMonth >= startMonth)) &&
                 (dYear < endYear || (dYear === endYear && dMonth <= endMonth));
        })
        .map(d => ({
          date: this.parseDate(d.date),
          value: d.value
        }))
        .sort((a, b) => a.date - b.date);

      if (rawData.length === 0) return [];

      const filledData = [rawData[0]];
      for (let i = 1; i < rawData.length; i++) {
        const prev = filledData[filledData.length - 1];
        const curr = rawData[i];
        const prevYear = prev.date.getFullYear();
        const prevMonth = prev.date.getMonth();
        const currYear = curr.date.getFullYear();
        const currMonth = curr.date.getMonth();

        const monthDiff = (currYear - prevYear) * 12 + (currMonth - prevMonth);
        if (monthDiff > 1) {
          const midMonth = prevMonth + 1;
          filledData.push({ date: new Date(prevYear, midMonth, 1), value: prev.value });
        }
        filledData.push(curr);
      }

      return filledData;
    }

    normalizeValue(value, min, max, inverted = false) {
      if (min === max) return 50;
      let normalized = ((value - min) / (max - min)) * 100;
      if (inverted) normalized = 100 - normalized;
      return Math.max(0, Math.min(100, normalized));
    }

    calculateWellbeingIndex() {
      const componentIds = this.getComponentIds();
      if (componentIds.length === 0) return [];

      const dataMap = {};
      componentIds.forEach(id => {
        const data = this.getDataInRange(id);
        data.forEach(d => {
          const key = d.date.toISOString();
          if (!dataMap[key]) dataMap[key] = { date: d.date };
          dataMap[key][id] = d.value;
        });
      });

      const result = Object.values(dataMap).map(point => {
        let totalWeight = 0;
        let weightedSum = 0;

        componentIds.forEach(id => {
          const config = this.componentWeightings[id];
          const rawValue = point[id];
          const range = this.statisticRanges[id];
          if (rawValue != null && !isNaN(rawValue) && range) {
            const normalized = this.normalizeValue(rawValue, range.min, range.max, config.inverted);
            weightedSum += normalized * config.weight;
            totalWeight += config.weight;
          }
        });

        return {
          date: point.date,
          value: totalWeight > 0 ? weightedSum / totalWeight : null
        };
      });

      return result.filter(d => d.value != null).sort((a, b) => a.date - b.date);
    }

    calculateStackedComponents() {
      const componentIds = this.getComponentIds();
      if (componentIds.length === 0) return [];

      const dataMap = {};
      const lastValues = {};
      componentIds.forEach(id => {
        lastValues[id] = null;
        const data = this.getDataInRange(id);
        data.forEach(d => {
          const key = d.date.toISOString();
          if (!dataMap[key]) dataMap[key] = { date: d.date };
          dataMap[key][id] = d.value;
          lastValues[id] = d.value;
        });
      });

      const dates = Object.values(dataMap).map(p => p.date).sort((a, b) => a - b);
      const allDates = [...new Set(dates)].sort((a, b) => a - b);

      const filledLastValues = {};
      componentIds.forEach(id => filledLastValues[id] = null);

      const result = allDates.map(date => {
        const key = date.toISOString();
        const point = dataMap[key];
        const result = { date };

        let cumulative = 0;
        componentIds.forEach(id => {
          const config = this.componentWeightings[id];
          let rawValue = point?.[id];
          if (rawValue == null || isNaN(rawValue)) {
            rawValue = filledLastValues[id];
          }
          if (rawValue != null && !isNaN(rawValue)) {
            const range = this.statisticRanges[id];
            const normalized = range ? this.normalizeValue(rawValue, range.min, range.max, config.inverted) : 0;
            const scaled = normalized * config.weight;
            result[id] = scaled;
            result[`${id}_base`] = cumulative;
            cumulative += scaled;
            filledLastValues[id] = rawValue;
          } else {
            result[id] = 0;
            result[`${id}_base`] = cumulative;
          }
        });

        result.total = cumulative;
        return result;
      }).filter(d => d.total > 0);

      return result;
    }

    buildTermsFromDateRange() {
      if (!this.government || !Array.isArray(this.government)) return [];

      const counters = {};

      return this.government
        .filter(period => !!this.getPartyColor(period.party))
        .map(period => {
          const party = this.getPartyKey(period.party);
          counters[party] = (counters[party] || 0) + 1;

          const start = new Date(period.start_date);
          const end = new Date(period.end_date);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

          return {
            party,
            term_number: counters[party],
            term_name: `${party} term ${counters[party]}`,
            start_date: period.start_date,
            end_date: period.end_date,
            start,
            end
          };
        })
        .filter(Boolean);
    }

    getPartyKey(party) {
      return party;
    }

    getPartyColor(party) {
      const partyKey = this.getPartyKey(party);
      return this.partyColors[partyKey] || this.partyColors[party] || null;
    }

    getTermsToDisplay() {
      const terms = this.buildTermsFromDateRange();
      return terms.filter(term => {
        const termStart = new Date(term.start_date);
        const termEnd = new Date(term.end_date);
        return termEnd >= this.dateRangeStart && termStart <= this.dateRangeEnd;
      });
    }

    render() {
      if (!this.document) return;

      const containerEl = this.document.getElementById("timeline-chart");
      if (!containerEl) return;

      containerEl.innerHTML = "";

      const stackedData = this.calculateStackedComponents();
      if (stackedData.length === 0) {
        containerEl.textContent = "No data to display";
        return;
      }

      // Always recalculate width to handle initial layout and resize events
      const containerWidth = containerEl.clientWidth;
      this.width = Math.max(containerWidth - this.margin.left - this.margin.right, 320);

      const svg = this.d3.select(containerEl).append("svg")
        .attr("width", this.width + this.margin.left + this.margin.right)
        .attr("height", this.height + this.margin.top + this.margin.bottom);

      svg.append("g").attr("class", "government-backgrounds");

      const terms = this.getTermsToDisplay();
      const { xScale, yScale } = this.createScales(stackedData);

      this.drawPartyBackgrounds(svg, xScale, terms);

      const g = svg.append("g")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

      this.drawAreas(g, xScale, yScale, stackedData);
      this.drawAxes(g, xScale, yScale);
      this.drawPrimeMinisterPhotos(g, xScale, terms);
      this.drawTitle(svg);
    }

    createScales(_stackedData) {
      const domainStart = this.dateRangeStart;
      const domainEnd = this.dateRangeEnd;
      
      const xScale = this.d3.scaleTime()
        .domain([domainStart, domainEnd])
        .range([0, this.width]);

      const yScale = this.d3.scaleLinear()
        .domain([0, 100])
        .range([this.height, 0]);

      return { xScale, yScale };
    }

    drawAxes(g, xScale, yScale) {
      const domain = xScale.domain();
      const startYear = domain[0].getFullYear();
      const endYear = Math.max(domain[1].getFullYear(), new Date().getFullYear());

      const tickValues = [];
      const tickLabels = [];
      for (let year = startYear; year <= endYear; year++) {
        for (let month = 0; month < 12; month++) {
          const tickDate = new Date(year, month, 1);
          if (tickDate >= domain[0] && tickDate <= domain[1]) {
            tickValues.push(tickDate);
            tickLabels.push(month === 0 ? year.toString() : "");
          }
        }
      }

      g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${this.height})`)
        .call(this.d3.axisBottom(xScale).tickValues(tickValues).tickFormat((d, i) => tickLabels[i]));

      g.append("g")
        .attr("class", "y-axis")
        .call(this.d3.axisLeft(yScale).ticks(5));

      g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - this.margin.left + 15)
        .attr("x", 0 - (this.height / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("font-size", "12px")
        .style("fill", "#666")
        .text("Wellbeing Index");
    }

    drawAreas(g, xScale, yScale, stackedData) {
      const componentIds = this.getComponentIds();

      componentIds.forEach(id => {
        const area = this.d3.area()
          .x(d => xScale(d.date))
          .y0(d => yScale(d[`${id}_base`] || 0))
          .y1(d => yScale((d[`${id}_base`] || 0) + (d[id] || 0)))
          .curve(this.d3.curveLinear);

        g.append("path")
          .datum(stackedData)
          .attr("class", `area-${id}`)
          .attr("d", area)
          .style("fill", this.componentColors[id])
          .style("opacity", this.styles.area.opacity);
      });
    }

    drawPartyBackgrounds(svg, xScale, terms) {
      if (!terms || terms.length === 0) return;

      const bgGroup = svg.select(".government-backgrounds");

      const rangeStartX = this.margin.left + xScale(this.dateRangeStart);
      const rangeEndX = this.margin.left + xScale(this.dateRangeEnd);

      terms.forEach(term => {
        let x1 = this.margin.left + xScale(term.start);
        let x2 = this.margin.left + xScale(term.end);
        
        x1 = Math.max(x1, rangeStartX);
        x2 = Math.min(x2, rangeEndX);
        
        const width = Math.max(0, x2 - x1);
        if (!isFinite(x1) || !isFinite(x2) || width === 0) return;

        const color = this.getPartyColor(term.party);

        bgGroup.append("rect")
          .attr("x", x1)
          .attr("y", this.margin.top + this.height)
          .attr("width", width)
          .attr("height", 60)
          .style("fill", color)
          .style("opacity", this.styles.backgroundColor.opacity);
      });
    }

    drawLegend(g, _svg) {
      const componentIds = this.getComponentIds();
      const legendY = -20;
      const itemWidth = 130;

      componentIds.forEach((id, idx) => {
        const x = idx * itemWidth;
        const config = this.componentWeightings[id];

        g.append("rect")
          .attr("x", x)
          .attr("y", legendY)
          .attr("width", 16)
          .attr("height", 12)
          .style("fill", this.componentColors[id])
          .style("opacity", 0.7);

        g.append("text")
          .attr("x", x + 20)
          .attr("y", legendY + 10)
          .style("font-size", "10px")
          .style("fill", "#333")
          .text(`${config.name} (${(config.weight * 100).toFixed(0)}%)`);
      });
    }

    drawTitle(svg) {
      svg.append("text")
        .attr("x", this.margin.left + 10)
        .attr("y", 20)
        .style("font-size", "16px")
        .style("font-weight", "bold")
        .text("Australian Wellbeing Index");
      
      svg.append("text")
        .attr("x", this.margin.left + 10)
        .attr("y", 38)
        .style("font-size", "11px")
        .style("fill", "#666")
        .text("Stacked components with custom weightings | Party backgrounds | PM markers");
    }

    getPMSlug(name) {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    drawPrimeMinisterPhotos(g, xScale, _terms) {
      if (!this.government || !Array.isArray(this.government)) return;

      const photoSize = 30;
      const photoY = this.height + 25;

      const pmsToShow = [];
      this.government.forEach(pm => {
        const pmStart = new Date(pm.start_date);
        const pmEnd = new Date(pm.end_date);
        
        if (pmEnd < this.dateRangeStart || pmStart > this.dateRangeEnd) return;
        
        const visibleStart = new Date(Math.max(pmStart.getTime(), this.dateRangeStart.getTime()));
        
        pmsToShow.push({
          pm,
          visibleStart
        });
      });

      pmsToShow.forEach(({ pm, visibleStart }) => {
        const xStart = xScale(visibleStart);
        
        if (!isFinite(xStart)) return;

        const slug = this.getPMSlug(pm.name);
        const photoPath = `/assets/images/prime-ministers/${slug}.jpg`;

        g.append("image")
          .attr("xlink:href", photoPath)
          .attr("x", xStart - photoSize / 2)
          .attr("y", photoY)
          .attr("width", photoSize)
          .attr("height", photoSize)
          .attr("clip-path", "circle(50%)")
          .style("cursor", "pointer")
          .append("title")
          .text(`${pm.name} (${pm.start_date} to ${pm.end_date})`);
      });
    }
  }

  return WellbeingIndexGraph;
});

if (typeof window !== "undefined" && window.document && window.WellbeingIndexGraph) {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new window.WellbeingIndexGraph();
    app.init();
  });
}
