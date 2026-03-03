---
---
let allReports = [];
let searchTimeout;
let uniqueThinkTanks = new Set();

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchPattern(query, useRegex) {
  if (useRegex) {
    return new RegExp(query, "gi");
  }
  return new RegExp(escapeRegex(query), "gi");
}


// Load reports from JSON API
async function loadReports() {
  const loadingEl = document.getElementById("loading");
  loadingEl.style.display = "block";
    
  try {
    const response = await fetch("/report-search/api.json");
    const jsonData = await response.json();
        
    const reports = jsonData.reports || [];
        
    // Track report indices per think tank
    const thinkTankIndices = new Map();
        
    // Collect unique think tanks and assign report indices
    allReports = reports.map(report => {
      uniqueThinkTanks.add(report.think_tank);
            
      // Get or initialize the index for this think tank
      const currentIndex = thinkTankIndices.get(report.slug) || 0;
      thinkTankIndices.set(report.slug, currentIndex + 1);
            
      return {
        ...report,
        reportIndex: currentIndex,
        recommendations: report.recommendations || []
      };
    });
        
    // Initialize filters
    initializeFilters();
        
    loadingEl.style.display = "none";
    updateStats();
        
  } catch (error) {
    console.error("Error loading reports:", error);
    loadingEl.innerHTML = `<div class="no-results">Error loading reports: ${error.message}</div>`;
  }
}

// Initialize filter pills
function initializeFilters() {
  const filterList = document.getElementById("filterList");
  const tanks = Array.from(uniqueThinkTanks).sort();
    
  // Add "All" pill
  const allPill = document.createElement("a");
  allPill.className = "pill active-filter";
  allPill.textContent = "All";
  allPill.onclick = (e) => {
    e.preventDefault();
    filterByThinkTanks([]);
  };
  filterList.appendChild(allPill);
    
  // Add individual think tank pills
  tanks.forEach(tank => {
    const pill = document.createElement("a");
    pill.className = "pill";
    pill.textContent = tank;
    pill.onclick = (e) => {
      e.preventDefault();
      toggleThinkTankFilter(tank, e.target);
    };
    filterList.appendChild(pill);
  });
}

// Track selected filters
let selectedThinkTanks = [];

// Toggle think tank filter
function toggleThinkTankFilter(tank, element) {
  const allPill = document.querySelector(".pill-row .pill:first-child");
    
  if (selectedThinkTanks.includes(tank)) {
    selectedThinkTanks = selectedThinkTanks.filter(t => t !== tank);
  } else {
    selectedThinkTanks.push(tank);
  }
    
  // Update UI
  const pills = document.querySelectorAll(".pill-row .pill");
  if (selectedThinkTanks.length === 0) {
    pills.forEach(p => p.classList.remove("active-filter"));
    allPill.classList.add("active-filter");
  } else {
    allPill.classList.remove("active-filter");
    pills.forEach((p, i) => {
      if (i === 0) return; // Skip "All" pill
      if (selectedThinkTanks.includes(p.textContent)) {
        p.classList.add("active-filter");
      } else {
        p.classList.remove("active-filter");
      }
    });
  }
    
  performSearch();
}

// Filter by think tanks
function filterByThinkTanks(tanks) {
  selectedThinkTanks = tanks;
    
  // Update UI
  const pills = document.querySelectorAll(".pill-row .pill");
  pills.forEach((p, i) => {
    if (i === 0) {
      p.classList.toggle("active-filter", tanks.length === 0);
    } else {
      p.classList.toggle("active-filter", tanks.includes(p.textContent));
    }
  });
    
  performSearch();
}

// Get reports to search
function getReportsToSearch() {
  if (selectedThinkTanks.length === 0) {
    return allReports;
  }
  return allReports.filter(r => selectedThinkTanks.includes(r.think_tank));
}

// Update stats display
function updateStats() {
  const statsEl = document.getElementById("stats");
  const reportsToSearch = getReportsToSearch();
  const tankCount = selectedThinkTanks.length === 0 ? uniqueThinkTanks.size : selectedThinkTanks.length;
    
  statsEl.textContent = `Searching ${reportsToSearch.length} reports from ${tankCount} think tank${tankCount > 1 ? "s" : ""}`;
}

// Perform search
function performSearch() {
  const query = document.getElementById("searchInput").value.trim();
  const regexToggle = document.getElementById("regexToggle");
  const useRegex = regexToggle ? regexToggle.checked : false;
  const resultsEl = document.getElementById("results");
  const reportsToSearch = getReportsToSearch();
    
  updateStats();
    
  if (!query) {
    resultsEl.innerHTML = '<div class="no-results">Enter a search term to find reports</div>';
    return;
  }
    
  if (!useRegex && query.length < 2) {
    resultsEl.innerHTML = '<div class="no-results">Please enter at least 2 characters</div>';
    return;
  }

  let searchPattern;
  try {
    searchPattern = buildSearchPattern(query, useRegex);
  } catch (error) {
    resultsEl.innerHTML = `<div class="no-results">Invalid regex: ${error.message}</div>`;
    return;
  }
    
  // Filter and search recommendations
  const searchResults = [];
  reportsToSearch.forEach(report => {
    const recommendations = report.recommendations || [];
    recommendations.forEach((rec, recIndex) => {
      if (!searchPattern.test(rec)) return;
      searchPattern.lastIndex = 0;
            
      // Use full recommendation text
      let excerpt = rec;
            
      // Highlight query in excerpt
      excerpt = excerpt.replace(searchPattern, "<mark>$&</mark>");
      searchPattern.lastIndex = 0;
            
      searchResults.push({
        report,
        recommendationIndex: recIndex,
        recommendationId: `${report.slug}.${report.reportIndex}.${recIndex}`,
        excerpt,
        title: report.title || `Report #${report.report_num}`
      });
    });
  });
    
  // Sort by report (group similar results together)
  const sortedResults = searchResults.sort((a, b) => {
    if (a.report.think_tank !== b.report.think_tank) {
      return a.report.think_tank.localeCompare(b.report.think_tank);
    }
    return a.report.report_num - b.report.report_num;
  });
    
  // Display results
  if (sortedResults.length === 0) {
    resultsEl.innerHTML = '<div class="no-results">No results found. Try different search terms.</div>';
    return;
  }
    
  const html = sortedResults.map(({ report, recommendationId, excerpt, title }) => `
        <div class="result-card">
          <div class="result-header">
            <div>
              <div class="think-tank">${report.think_tank} <span class="rec-id">${recommendationId}</span></div>
              <div class="report-meta">${title}</div>
            </div>
          </div>
          <div class="result-excerpt">${excerpt}</div>
          <a href="${report.source_url}" target="_blank" class="source-link">View Full Report →</a>
        </div>
      `).join("");
    
  resultsEl.innerHTML = html;
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput");
  const regexToggle = document.getElementById("regexToggle");
    
  // Debounced search on input
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
  });

  regexToggle.addEventListener("change", performSearch);
    
  // Load reports on page load
  loadReports();
});
