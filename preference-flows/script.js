const EPSILON = 1e-9;

function getInitialFlowData() {
  const loaded = (window.preferenceFlowDefault && typeof window.preferenceFlowDefault === "object")
    ? window.preferenceFlowDefault
    : {};
  const hasCandidates = Array.isArray(loaded.candidates) && loaded.candidates.length > 0;
  const hasBallots = Array.isArray(loaded.ballots) && loaded.ballots.length > 0;
  const hasSeats = Number.isInteger(loaded.seats) && loaded.seats > 0;
  const loadedAaSeats = Number.isInteger(loaded.aa_seats)
    ? loaded.aa_seats
    : (Number.isInteger(loaded.aaSeats) ? loaded.aaSeats : null);
  const hasAaSeats = Number.isInteger(loadedAaSeats) && loadedAaSeats >= 0;

  if (!hasCandidates && !hasBallots && !hasSeats && !hasAaSeats) {
    return null;
  }

  return {
    candidates: hasCandidates
      ? loaded.candidates
      : null,
    ballots: hasBallots
      ? loaded.ballots
      : null,
    seats: hasSeats
      ? loaded.seats
      : null,
    aa_seats: hasAaSeats
      ? loadedAaSeats
      : null
  };
}

function applyFlowDataToInputs(data, candidatesEl, ballotsEl, seatsEl, aaSeatsEl) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const ballots = Array.isArray(data.ballots) ? data.ballots : [];
  const aaSeats = Number.isInteger(data.aa_seats)
    ? data.aa_seats
    : (Number.isInteger(data.aaSeats) ? data.aaSeats : 0);

  candidatesEl.value = candidates.join("\n");
  ballotsEl.value = ballots.join("\n");
  if (Number.isInteger(data.seats) && data.seats > 0) {
    seatsEl.value = String(data.seats);
  }
  if (Number.isInteger(aaSeats) && aaSeats >= 0) {
    aaSeatsEl.value = String(Math.max(0, aaSeats));
  }
}

function buildPartyColorLookup() {
  const entries = Array.isArray(window.preferenceFlowParties) ? window.preferenceFlowParties : [];
  const colorMap = new Map();

  entries.forEach((party) => {
    if (!party || !party.color) {
      return;
    }

    const names = [party.name, party.long_name]
      .filter(Boolean)
      .map((value) => normalizeName(String(value)).toLowerCase());

    names.forEach((key) => {
      if (!colorMap.has(key)) {
        colorMap.set(key, String(party.color));
      }
    });
  });

  return colorMap;
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function parseCandidateLine(line) {
  const normalized = normalizeName(line);
  if (!normalized) {
    return null;
  }

  const isAA = /\(AA\)$/i.test(normalized);
  const name = normalizeName(normalized.replace(/\(AA\)$/i, ""));

  if (!name) {
    return null;
  }

  return {
    name,
    displayName: isAA ? `${name} (AA)` : name,
    isAA
  };
}

function parseCandidates(raw) {
  const seen = new Set();
  const candidates = [];
  const aaCandidates = new Set();

  raw
    .split(/\r?\n/)
    .map((line) => parseCandidateLine(line))
    .filter(Boolean)
    .forEach((candidateEntry) => {
      const key = candidateEntry.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidateEntry.name);
      }

      if (candidateEntry.isAA) {
        aaCandidates.add(candidateEntry.name);
      }
    });

  return {
    candidates,
    aaCandidates
  };
}

function parseBallotLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:=-]\s*(.+)$/);
  if (!match) {
    return {
      error: `Invalid ballot format: "${line}"`
    };
  }

  const count = Number.parseFloat(match[1]);
  if (!Number.isFinite(count) || count < 0) {
    return {
      error: `Invalid vote count in: "${line}"`
    };
  }

  const preferences = match[2]
    .split(/>|,|\|/)
    .map((part) => normalizeName(part))
    .filter(Boolean);

  if (preferences.length === 0) {
    return {
      error: `Missing preferences in: "${line}"`
    };
  }

  return {
    count,
    preferences
  };
}

function parseBallots(raw, candidates) {
  const canonicalNames = new Map(candidates.map((name) => [name.toLowerCase(), name]));
  candidates.forEach((name) => {
    canonicalNames.set(`${name.toLowerCase()} (aa)`, name);
  });
  const parsedBallots = [];
  const errors = [];
  // HTML compression can flatten textarea newlines, so recover ballot boundaries.
  const normalizedRaw = raw.replace(/\s+(?=\d+(?:\.\d+)?\s*[:=-]\s*)/g, "\n");

  normalizedRaw.split(/\r?\n/).forEach((line) => {
    const parsed = parseBallotLine(line);

    if (!parsed) {
      return;
    }

    if (parsed.error) {
      errors.push(parsed.error);
      return;
    }

    const deduped = [];
    const seen = new Set();

    parsed.preferences.forEach((name) => {
      const canonical = canonicalNames.get(name.toLowerCase());
      if (!canonical) {
        errors.push(`Unknown candidate "${name}" in ballot: "${line.trim()}"`);
        return;
      }

      const key = canonical.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(canonical);
      }
    });

    if (deduped.length === 0) {
      errors.push(`Ballot has no valid preferences: "${line.trim()}"`);
      return;
    }

    parsedBallots.push({
      count: parsed.count,
      ranking: deduped
    });
  });

  return {
    ballots: parsedBallots,
    errors
  };
}

function findNextPreference(ranking, continuing) {
  for (const name of ranking) {
    if (continuing.has(name)) {
      return name;
    }
  }
  return null;
}

function makeRoundNode(round, candidate) {
  return `R${round}:${candidate}`;
}

function parseRoundNode(nodeId) {
  const match = /^R(\d+):(.+)$/.exec(nodeId);
  if (!match) {
    return null;
  }

  return {
    round: Number.parseInt(match[1], 10),
    candidate: match[2]
  };
}

function toFixedVotes(value) {
  return Number(value.toFixed(3));
}

function formatNumber(value, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "0";
  }

  return parsed
    .toFixed(Math.max(0, decimals))
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function ordinalSuffix(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
  case 1:
    return `${value}st`;
  case 2:
    return `${value}nd`;
  case 3:
    return `${value}rd`;
  default:
    return `${value}th`;
  }
}

function aggregateFlow(flowMap, source, target, value) {
  if (value <= EPSILON) {
    return;
  }

  const key = `${source}->${target}`;
  flowMap.set(key, (flowMap.get(key) || 0) + value);
}

function removeRoundFlows(flowMap, removedRound) {
  const keysToDelete = [];

  flowMap.forEach((_, key) => {
    const [source, target] = key.split("->");
    const sourceRound = parseRoundNode(source);
    const targetRound = parseRoundNode(target);

    if (
      (sourceRound && sourceRound.round === removedRound)
      || (targetRound && targetRound.round === removedRound)
    ) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => {
    flowMap.delete(key);
  });
}

function runStvSimulation(candidates, ballots, seats, aaSeats, aaCandidates) {
  const totalVotes = ballots.reduce((sum, ballot) => sum + ballot.count, 0);
  const quota = totalVotes / (seats + 1);
  const continuing = new Set(candidates);
  const elected = [];
  const roundTallies = [];
  const roundEvents = new Map();
  const flowMap = new Map();
  const eliminatedAtRound = new Map();
  const electedAtRound = new Map();
  const aaCandidateSet = aaCandidates instanceof Set ? new Set(aaCandidates) : new Set();
  const aaSeatTarget = Math.max(0, Math.min(aaSeats, seats));
  const nonAaSeatTarget = Math.max(0, seats - aaSeatTarget);
  let aaMode = false;
  let aaStartRound = null;

  const stateBallots = ballots.map((ballot) => ({
    ranking: ballot.ranking,
    weight: ballot.count,
    current: null,
    active: true
  }));

  let round = 1;

  while (continuing.size > 0 && elected.length < seats) {
    // Allocate every active ballot to the current highest continuing preference.
    for (const state of stateBallots) {
      if (!state.active || state.current) {
        continue;
      }

      const next = findNextPreference(state.ranking, continuing);
      if (!next) {
        state.active = false;
        continue;
      }

      state.current = next;
    }

    const tally = new Map();
    for (const candidate of continuing) {
      tally.set(candidate, 0);
    }

    for (const state of stateBallots) {
      if (state.active && state.current && continuing.has(state.current)) {
        tally.set(state.current, tally.get(state.current) + state.weight);
      }
    }

    const talliesArray = Array.from(tally.entries())
      .map(([candidate, votes]) => ({ candidate, votes }))
      .sort((a, b) => b.votes - a.votes || a.candidate.localeCompare(b.candidate));

    roundTallies.push({
      round,
      tallies: talliesArray
    });

    const qualifying = talliesArray.filter((entry) => entry.votes > quota + EPSILON);

    if (!aaMode && aaSeatTarget > 0 && elected.length >= nonAaSeatTarget && qualifying.length > 0) {
      aaMode = true;
      aaStartRound = round;

      // Drop the counterfactual trigger round from outputs and links.
      roundTallies.pop();
      roundEvents.delete(round);
      removeRoundFlows(flowMap, round);

      const unelectedAaCandidates = candidates.filter((candidate) => aaCandidateSet.has(candidate) && !elected.includes(candidate));
      continuing.clear();
      unelectedAaCandidates.forEach((candidate) => {
        continuing.add(candidate);
        eliminatedAtRound.delete(candidate);
      });

      // Reset ballot weights for the AA count and pre-allocate to find next AA preference.
      for (const state of stateBallots) {
        if (state.weight > EPSILON) {
          state.active = true;
        }
        state.current = null;
      }
      continue;
    }

    if (qualifying.length > 0) {
      const winner = qualifying[0];
      const winnerName = winner.candidate;
      const winnerVotes = winner.votes;

      elected.push(winnerName);
      electedAtRound.set(winnerName, round);

      const surplus = winnerVotes - quota;
      continuing.delete(winnerName);
      const willFinalizeAfterRound = elected.length >= seats || continuing.size + elected.length <= seats;

      if (surplus > EPSILON && !willFinalizeAfterRound) {
        const transferValue = surplus / winnerVotes;
        roundEvents.set(
          round,
          `${winnerName} elected, transfer surplus at value ${formatNumber(transferValue, 4)}`
        );
      } else {
        roundEvents.set(round, `${winnerName} elected`);
      }

      if (!willFinalizeAfterRound) {
        for (const entry of talliesArray) {
          if (entry.candidate === winnerName || !continuing.has(entry.candidate)) {
            continue;
          }

          aggregateFlow(
            flowMap,
            makeRoundNode(round, entry.candidate),
            makeRoundNode(round + 1, entry.candidate),
            entry.votes
          );
        }

        if (surplus > EPSILON) {
          const transferFraction = surplus / winnerVotes;

          for (const state of stateBallots) {
            if (!state.active || state.current !== winnerName) {
              continue;
            }

            const transferWeight = state.weight * transferFraction;
            const retainedWeight = state.weight - transferWeight;

            state.active = false;
            state.weight = retainedWeight;

            if (transferWeight <= EPSILON) {
              continue;
            }

            const next = findNextPreference(state.ranking, continuing);
            if (next) {
              aggregateFlow(
                flowMap,
                makeRoundNode(round, winnerName),
                makeRoundNode(round + 1, next),
                transferWeight
              );

              stateBallots.push({
                ranking: state.ranking,
                weight: transferWeight,
                current: null,
                active: true
              });
            } else {
              aggregateFlow(
                flowMap,
                makeRoundNode(round, winnerName),
                `R${round + 1}:Exhausted`,
                transferWeight
              );
            }
          }
        }
      }
    } else {
      const loser = talliesArray[talliesArray.length - 1];
      const loserName = loser.candidate;
      continuing.delete(loserName);
      eliminatedAtRound.set(loserName, round);
      roundEvents.set(round, `${loserName} eliminated, transfer ballots`);

      const willFinalizeAfterRound = continuing.size + elected.length <= seats;

      if (!willFinalizeAfterRound) {
        for (const entry of talliesArray) {
          if (entry.candidate === loserName || !continuing.has(entry.candidate)) {
            continue;
          }

          aggregateFlow(
            flowMap,
            makeRoundNode(round, entry.candidate),
            makeRoundNode(round + 1, entry.candidate),
            entry.votes
          );
        }

        for (const state of stateBallots) {
          if (!state.active || state.current !== loserName) {
            continue;
          }

          state.current = null;
          const next = findNextPreference(state.ranking, continuing);

          if (next) {
            aggregateFlow(
              flowMap,
              makeRoundNode(round, loserName),
              makeRoundNode(round + 1, next),
              state.weight
            );
          } else {
            aggregateFlow(
              flowMap,
              makeRoundNode(round, loserName),
              `R${round + 1}:Exhausted`,
              state.weight
            );
            state.active = false;
          }
        }
      }
    }

    if (continuing.size + elected.length <= seats) {
      const remainder = Array.from(continuing);
      remainder.forEach((candidate) => {
        if (elected.length >= seats) {
          return;
        }

        const candidateVotes = (tally.get(candidate) || 0);
        elected.push(candidate);
        if (candidateVotes > quota + EPSILON) {
          electedAtRound.set(candidate, round);
        }
      });
      break;
    }

    round += 1;
    if (round > 40) {
      break;
    }
  }

  const links = [];
  flowMap.forEach((value, key) => {
    const [source, target] = key.split("->");
    const sourceRoundNode = parseRoundNode(source);
    const targetRoundNode = parseRoundNode(target);

    if (sourceRoundNode) {
      const eliminatedRound = eliminatedAtRound.get(sourceRoundNode.candidate);
      const electedRound = electedAtRound.get(sourceRoundNode.candidate);

      if ((eliminatedRound && sourceRoundNode.round > eliminatedRound) || (electedRound && sourceRoundNode.round > electedRound)) {
        return;
      }
    }

    if (targetRoundNode) {
      const eliminatedRound = eliminatedAtRound.get(targetRoundNode.candidate);
      const electedRound = electedAtRound.get(targetRoundNode.candidate);

      if ((eliminatedRound && targetRoundNode.round > eliminatedRound) || (electedRound && targetRoundNode.round > electedRound)) {
        return;
      }
    }

    links.push({
      source,
      target,
      value
    });
  });

  return {
    totalVotes,
    quota,
    seats,
    aaSeats: aaSeatTarget,
    elected,
    electedOrder: Object.fromEntries(elected.map((candidate, index) => [candidate, index + 1])),
    electedAtRound: Object.fromEntries(electedAtRound),
    eliminatedAtRound: Object.fromEntries(eliminatedAtRound),
    roundEvents: Object.fromEntries(roundEvents),
    roundTallies,
    links,
    aaStartRound
  };
}

function candidateFromNodeId(nodeId) {
  const parts = nodeId.split(":");
  return parts[1] || nodeId;
}

function nodeLabel(nodeId) {
  const parts = nodeId.split(":");
  const roundText = (parts[0] || "").replace("R", "Round ");
  return `${parts[1]} (${roundText})`;
}

function buildSankeyData(simulation) {
  const nodeMap = new Map();

  simulation.roundTallies.forEach((roundData) => {
    roundData.tallies.forEach((entry) => {
      if (entry.votes <= EPSILON) {
        return;
      }

      const id = makeRoundNode(roundData.round, entry.candidate);
      nodeMap.set(id, {
        id,
        name: nodeLabel(id),
        candidate: candidateFromNodeId(id),
        fixedValue: toFixedVotes(entry.votes)
      });
    });
  });

  simulation.links.forEach((link) => {
    if (!nodeMap.has(link.source)) {
      nodeMap.set(link.source, {
        id: link.source,
        name: nodeLabel(link.source),
        candidate: candidateFromNodeId(link.source)
      });
    }

    if (!nodeMap.has(link.target)) {
      nodeMap.set(link.target, {
        id: link.target,
        name: nodeLabel(link.target),
        candidate: candidateFromNodeId(link.target)
      });
    }
  });

  const nodes = Array.from(nodeMap.values());

  const links = simulation.links
    .filter((link) => link.value > EPSILON)
    .map((link) => ({
      source: link.source,
      target: link.target,
      value: toFixedVotes(link.value)
    }));

  return { nodes, links };
}

function buildSimulationSlice(simulation, options = {}) {
  const minRound = Number.isInteger(options.minRound) ? options.minRound : Number.NEGATIVE_INFINITY;
  const maxRound = Number.isInteger(options.maxRound) ? options.maxRound : Number.POSITIVE_INFINITY;
  const roundInRange = (round) => round >= minRound && round <= maxRound;

  const roundTallies = simulation.roundTallies
    .filter((roundData) => roundInRange(roundData.round))
    .map((roundData) => ({
      round: roundData.round,
      tallies: roundData.tallies.map((entry) => ({ ...entry }))
    }));

  const links = simulation.links.filter((link) => {
    const sourceRound = parseRoundNode(link.source);
    const targetRound = parseRoundNode(link.target);
    return sourceRound && targetRound && roundInRange(sourceRound.round) && roundInRange(targetRound.round);
  });

  const electedAtRoundEntries = Object.entries(simulation.electedAtRound || {}).filter(([, round]) => {
    const parsedRound = Number(round);
    return Number.isFinite(parsedRound) && roundInRange(parsedRound);
  });
  const eliminatedAtRoundEntries = Object.entries(simulation.eliminatedAtRound || {}).filter(([, round]) => {
    const parsedRound = Number(round);
    return Number.isFinite(parsedRound) && roundInRange(parsedRound);
  });
  const electedAtRound = Object.fromEntries(electedAtRoundEntries);
  const eliminatedAtRound = Object.fromEntries(eliminatedAtRoundEntries);

  const roundEvents = Object.fromEntries(
    Object.entries(simulation.roundEvents || {}).filter(([round]) => roundInRange(Number(round)))
  );

  const elected = simulation.elected.filter((candidate) => Object.prototype.hasOwnProperty.call(electedAtRound, candidate));

  return {
    totalVotes: simulation.totalVotes,
    quota: simulation.quota,
    seats: Number.isInteger(options.seats) ? options.seats : simulation.seats,
    aaSeats: Number.isInteger(options.aaSeats) ? options.aaSeats : simulation.aaSeats,
    elected,
    electedOrder: Object.fromEntries(elected.map((candidate, index) => [candidate, index + 1])),
    electedAtRound,
    eliminatedAtRound,
    roundEvents,
    roundTallies,
    links,
    aaStartRound: null
  };
}

function ensureAaChartPanel() {
  const existingPanel = document.getElementById("aaChartPanel");
  if (existingPanel) {
    return existingPanel;
  }

  const chartPanel = document.getElementById("chartContainer")?.closest(".panel");
  if (!chartPanel || !chartPanel.parentElement) {
    return null;
  }

  const panel = document.createElement("section");
  panel.id = "aaChartPanel";
  panel.className = "panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-header">
      <h2>AA Alluvial Diagram</h2>
    </div>
    <div id="aaChartContainer" class="chart-container">
      <svg id="aaFlowChart" aria-label="AA preference flow alluvial diagram"></svg>
    </div>
  `;

  chartPanel.insertAdjacentElement("afterend", panel);
  return panel;
}

function drawAlluvial(simulation, candidates, options = {}) {
  const chartSvgId = options.chartSvgId || "flowChart";
  const chartContainerId = options.chartContainerId || "chartContainer";
  const svg = d3.select(`#${chartSvgId}`);
  const chartContainer = document.getElementById(chartContainerId);
  svg.selectAll("*").remove();

  if (!chartContainer || !simulation || simulation.roundTallies.length === 0) {
    return;
  }

  const roundTotals = new Map(
    simulation.roundTallies.map((roundData) => [
      roundData.round,
      roundData.tallies.reduce((sum, entry) => sum + entry.votes, 0)
    ])
  );

  const width = chartContainer.clientWidth;
  const height = Math.max(460, simulation.roundTallies.length * 80 + 260);

  if (!Number.isFinite(width) || width <= 40) {
    return;
  }

  svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%").attr("height", height);

  const sankeyData = buildSankeyData(simulation);
  const linkedNodeIds = new Set();
  sankeyData.links.forEach((link) => {
    linkedNodeIds.add(link.source);
    linkedNodeIds.add(link.target);
  });

  const connectedNodes = sankeyData.nodes.filter((node) => linkedNodeIds.has(node.id));
  const isolatedNodes = sankeyData.nodes.filter((node) => !linkedNodeIds.has(node.id));

  const fallbackColorScale = d3.scaleOrdinal()
    .domain(candidates)
    .range([
      "#e76f51",
      "#264653",
      "#2a9d8f",
      "#e9c46a",
      "#7d8597",
      "#4f772d",
      "#bc4749",
      "#8f5cf7",
      "#adb5bd",
      "#7c3aed"
    ]);
  const partyColorLookup = buildPartyColorLookup();
  const colorForCandidate = (candidate) => {
    if (candidate === "Exhausted") {
      return "#adb5bd";
    }

    const key = normalizeName(String(candidate)).toLowerCase();
    return partyColorLookup.get(key) || fallbackColorScale(candidate);
  };

  const sankey = d3.sankey()
    .nodeId((d) => d.id)
    .nodeAlign(d3.sankeyLeft)
    .nodeSort((a, b) => b.value - a.value || a.candidate.localeCompare(b.candidate))
    .nodeWidth(18)
    .nodePadding(14)
    .extent([[20, 20], [width - 20, height - 20]]);

  const graph = connectedNodes.length > 0
    ? sankey({
      nodes: connectedNodes.map((node) => ({ ...node })),
      links: sankeyData.links.map((link) => ({ ...link }))
    })
    : { nodes: [], links: [] };

  const roundNumbers = Array.from(new Set(simulation.roundTallies.map((roundData) => roundData.round))).sort((a, b) => a - b);
  const roundSpacing = roundNumbers.length > 1 ? (width - 40 - 18) / (roundNumbers.length - 1) : 0;
  const fallbackRoundX = new Map(roundNumbers.map((roundNumber, index) => [roundNumber, 20 + roundSpacing * index]));
  const laidOutIsolatedNodes = [];

  if (isolatedNodes.length > 0) {
    const roundX = new Map();
    graph.nodes.forEach((nodeData) => {
      const parsed = parseRoundNode(nodeData.id);
      if (parsed && !roundX.has(parsed.round)) {
        roundX.set(parsed.round, { x0: nodeData.x0, x1: nodeData.x1 });
      }
    });

    const isolatedByRound = new Map();
    isolatedNodes.forEach((nodeData) => {
      const parsed = parseRoundNode(nodeData.id);
      if (!parsed) {
        return;
      }

      const existing = isolatedByRound.get(parsed.round) || [];
      existing.push({ ...nodeData, round: parsed.round, value: nodeData.fixedValue || 0 });
      isolatedByRound.set(parsed.round, existing);
    });

    isolatedByRound.forEach((nodesInRound, roundNumber) => {
      const xPosition = roundX.get(roundNumber) || {
        x0: fallbackRoundX.get(roundNumber) || 20,
        x1: (fallbackRoundX.get(roundNumber) || 20) + 18
      };
      const totalVotes = nodesInRound.reduce((sum, nodeData) => sum + (nodeData.value || 0), 0);
      const padding = 14;
      const availableHeight = Math.max(40, height - 40 - Math.max(0, nodesInRound.length - 1) * padding);
      const scale = totalVotes > EPSILON ? availableHeight / totalVotes : 0;
      let currentY = 20;

      nodesInRound
        .sort((a, b) => b.value - a.value || a.candidate.localeCompare(b.candidate))
        .forEach((nodeData, index) => {
          const nodeHeight = Math.max(2, scale > 0 ? nodeData.value * scale : 18);
          laidOutIsolatedNodes.push({
            ...nodeData,
            x0: xPosition.x0,
            x1: xPosition.x1,
            y0: currentY,
            y1: currentY + nodeHeight
          });

          currentY += nodeHeight;
          if (index < nodesInRound.length - 1) {
            currentY += padding;
          }
        });
    });
  }

  const renderedNodes = [...graph.nodes, ...laidOutIsolatedNodes];

  svg
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("class", "flow-link")
    .attr("data-self-link", (d) => (candidateFromNodeId(d.source.id) === candidateFromNodeId(d.target.id) ? "true" : "false"))
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => colorForCandidate(candidateFromNodeId(d.source.id)))
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .attr("stroke-opacity", (d) => (candidateFromNodeId(d.source.id) === candidateFromNodeId(d.target.id) ? 0 : 0.45))
    .attr("pointer-events", (d) => (candidateFromNodeId(d.source.id) === candidateFromNodeId(d.target.id) ? "none" : "auto"))
    .append("title")
    .text((d) => `${d.source.name} -> ${d.target.name}: ${toFixedVotes(d.value)} votes`);

  const node = svg
    .append("g")
    .selectAll("g")
    .data(renderedNodes)
    .join("g");

  node
    .append("rect")
    .attr("class", "flow-node")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("height", (d) => Math.max(2, d.y1 - d.y0))
    .attr("width", (d) => d.x1 - d.x0)
    .attr("fill", (d) => colorForCandidate(d.candidate))
    .attr("rx", 4)
    .attr("ry", 4)
    .append("title")
    .text((d) => `${d.name}\n${toFixedVotes(d.value)} votes`);

  const labels = node
    .append("text")
    .attr("x", (d) => (d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8))
    .attr("y", (d) => (d.y1 + d.y0) / 2 - 8)
    .attr("text-anchor", (d) => (d.x0 < width / 2 ? "start" : "end"))
    .attr("class", "node-label");

  labels.each(function appendNodeLabel(d) {
    const text = d3.select(this);
    const x = d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8;

    text.append("tspan")
      .attr("x", x)
      .text(d.candidate);

    const parsed = parseRoundNode(d.id);
    const electedRound = simulation.electedAtRound[d.candidate];
    const electedOrder = simulation.electedOrder[d.candidate];
    const isElectionRoundNode = parsed && electedRound === parsed.round;

    if (isElectionRoundNode) {
      const rankSuffix = simulation.seats > 1 && electedOrder ? ` ${ordinalSuffix(electedOrder)}` : "";
      text.append("tspan")
        .attr("class", "node-tick")
        .text(` ✓${rankSuffix}`);
    }

    text.append("tspan")
      .attr("x", x)
      .attr("dy", "1.2em")
      .attr("class", "node-votes")
      .text(() => {
        const roundNumber = parsed ? parsed.round : null;
        const roundTotal = roundNumber ? roundTotals.get(roundNumber) : null;

        if (!roundTotal || roundTotal <= EPSILON) {
          return `${toFixedVotes(d.value)}`;
        }

        const share = ((d.value / roundTotal) * 100).toFixed(1);
        return `${toFixedVotes(d.value)} (${share}%)`;
      });
  });

}

function renderSummary(simulation, seats) {
  const summary = document.getElementById("summary");
  const quotaShare = ((simulation.quota / simulation.totalVotes) * 100).toFixed(1);

  const electedList = simulation.elected.length > 0
    ? simulation.elected.map((name, index) => `<li>Seat ${index + 1}: ${name}</li>`).join("")
    : "<li>No candidate elected</li>";

  const roundHeaderHtml = simulation.roundTallies
    .map((round) => `<th>Round ${round.round}</th>`)
    .join("");

  const allCandidateNames = Array.from(new Set(
    simulation.roundTallies.flatMap((round) => round.tallies.map((entry) => entry.candidate))
  )).sort((a, b) => a.localeCompare(b));

  const roundVoteMaps = simulation.roundTallies.map((round) => {
    const votesByCandidate = new Map();
    round.tallies.forEach((entry) => {
      votesByCandidate.set(entry.candidate, entry.votes);
    });

    return {
      roundNumber: round.round,
      votesByCandidate
    };
  });

  const roundTableRowsHtml = allCandidateNames.map((candidateName) => {
    const electedRound = Number(simulation.electedAtRound[candidateName]);
    const eliminatedRound = Number(simulation.eliminatedAtRound[candidateName]);

    const valueCells = roundVoteMaps.map((roundData) => {
      const roundNumber = roundData.roundNumber;
      const goneInPreviousRound =
        (Number.isFinite(electedRound) && electedRound < roundNumber) ||
        (Number.isFinite(eliminatedRound) && eliminatedRound < roundNumber);

      if (goneInPreviousRound) {
        return "<td></td>";
      }

      const votes = roundData.votesByCandidate.get(candidateName);
      return `<td>${votes === undefined ? "" : toFixedVotes(votes)}</td>`;
    }).join("");

    return `<tr><th scope="row">${candidateName}</th>${valueCells}</tr>`;
  }).join("");

  const roundEventsRowHtml = simulation.roundTallies
    .map((round) => `<td>${simulation.roundEvents[String(round.round)] || `Round ${round.round} tallied`}</td>`)
    .join("");

  summary.innerHTML = `
    <div class="summary-top">
      <h3>Outcome</h3>
      <p>Total votes: <strong>${toFixedVotes(simulation.totalVotes)}</strong></p>
      <p>Seats: <strong>${seats}</strong></p>
      <p>AA seats: <strong>${simulation.aaSeats}</strong></p>
      <p>Droop quota: <strong>${simulation.quota.toFixed(2)} (${quotaShare}%)</strong></p>
      <ul>${electedList}</ul>
    </div>
    <div class="summary-bottom">
      <h3>Round-by-Round Tallies</h3>
      <div class="rounds-table-wrap">
        <table class="rounds-table">
          <thead>
            <tr><th>Candidate</th>${roundHeaderHtml}</tr>
          </thead>
          <tbody>
            ${roundTableRowsHtml}
            <tr class="round-event-row"><th scope="row">Event</th>${roundEventsRowHtml}</tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showValidationMessage(message, isError) {
  const element = document.getElementById("validationMessage");
  element.textContent = message;
  element.classList.toggle("error", Boolean(isError));
}

function runSimulationFromUi() {
  const candidatesInput = document.getElementById("candidatesInput").value;
  const ballotsInput = document.getElementById("ballotsInput").value;
  const seatsInput = Number.parseInt(document.getElementById("seatsInput").value, 10);
  const aaSeatsInput = Number.parseInt(document.getElementById("aaSeatsInput").value, 10);

  const parsedCandidates = parseCandidates(candidatesInput);
  const candidates = parsedCandidates.candidates;
  const aaCandidates = parsedCandidates.aaCandidates;
  if (candidates.length < 2) {
    showValidationMessage("Add at least two candidates.", true);
    return;
  }

  if (!Number.isInteger(seatsInput) || seatsInput < 1 || seatsInput > candidates.length) {
    showValidationMessage("Seats must be a whole number between 1 and the number of candidates.", true);
    return;
  }

  if (!Number.isInteger(aaSeatsInput) || aaSeatsInput < 0 || aaSeatsInput > seatsInput) {
    showValidationMessage("AA seats must be a whole number between 0 and total seats.", true);
    return;
  }

  if (aaSeatsInput > aaCandidates.size) {
    showValidationMessage("AA seats cannot exceed the number of candidates marked (AA).", true);
    return;
  }

  const { ballots, errors } = parseBallots(ballotsInput, candidates);
  if (errors.length > 0) {
    showValidationMessage(errors[0], true);
    return;
  }

  if (ballots.length === 0) {
    showValidationMessage("Add at least one ballot line.", true);
    return;
  }

  const simulation = runStvSimulation(candidates, ballots, seatsInput, aaSeatsInput, aaCandidates);
  const aaChartPanel = ensureAaChartPanel();
  const hasAaStage = Number.isInteger(simulation.aaStartRound)
    && simulation.roundTallies.some((roundData) => roundData.round >= simulation.aaStartRound);

  const mainSimulation = hasAaStage
    ? buildSimulationSlice(simulation, { maxRound: simulation.aaStartRound - 1 })
    : simulation;

  const quotaBadge = document.getElementById("quotaBadge");
  const quotaShare = ((simulation.quota / simulation.totalVotes) * 100).toFixed(1);
  quotaBadge.textContent = `Quota: ${simulation.quota.toFixed(2)} (${quotaShare}%)`;  

  drawAlluvial(mainSimulation, candidates, {
    chartSvgId: "flowChart",
    chartContainerId: "chartContainer"
  });

  if (aaChartPanel) {
    if (hasAaStage) {
      aaChartPanel.hidden = false;

      const aaSimulation = buildSimulationSlice(simulation, {
        minRound: simulation.aaStartRound,
        seats: simulation.aaSeats,
        aaSeats: simulation.aaSeats
      });
      const aaCandidateList = candidates.filter((candidate) => aaCandidates.has(candidate));

      drawAlluvial(aaSimulation, aaCandidateList.length > 0 ? aaCandidateList : candidates, {
        chartSvgId: "aaFlowChart",
        chartContainerId: "aaChartContainer"
      });
    } else {
      aaChartPanel.hidden = true;
      d3.select("#aaFlowChart").selectAll("*").remove();
    }
  }

  renderSummary(simulation, seatsInput);
  showValidationMessage("", false);
}

document.addEventListener("DOMContentLoaded", () => {
  const candidatesEl = document.getElementById("candidatesInput");
  const ballotsEl = document.getElementById("ballotsInput");
  const seatsEl = document.getElementById("seatsInput");
  const aaSeatsEl = document.getElementById("aaSeatsInput");
  const initialFlowData = getInitialFlowData();

  if (initialFlowData) {
    applyFlowDataToInputs(initialFlowData, candidatesEl, ballotsEl, seatsEl, aaSeatsEl);
  }

  document.getElementById("runSimulation").addEventListener("click", runSimulationFromUi);
  runSimulationFromUi();

  window.addEventListener("resize", () => {
    runSimulationFromUi();
  });

  document.getElementById("candidatesInput").addEventListener("change", runSimulationFromUi);
  document.getElementById("ballotsInput").addEventListener("change", runSimulationFromUi);
  document.getElementById("seatsInput").addEventListener("change", runSimulationFromUi);
  document.getElementById("aaSeatsInput").addEventListener("change", runSimulationFromUi);
});
