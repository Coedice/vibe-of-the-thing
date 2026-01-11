const url = "https://script.google.com/macros/s/AKfycbwaF6fjMSKBsactYtgMGsZRYM_Ey5ZKiW7RsIsIYic96gJVZOFS2G-wm3yV1E-8Xpvv/exec";
const formValues = [
    "bill",
    "speaker-list"
];

let billDebates = [];
let isFirstLoad = true;

function parseDoc(doc) {
    // Get bill debate program items
    let programItems = [];
    for (const billLink of doc.getElementsByTagName("a")) {
        const href = billLink.getAttribute("href");
        if (href == null || !href.startsWith("http://parlinfo.aph.gov.au/parlInfo/search/display/display.w3p;page=0;query=BillId%3A")) {
            continue;
        }

        // Get program item
        let programItem = billLink;
        while (programItem.parentNode != null) {
            if (programItem.className == "programItem itemRow") {
                break;
            }
            programItem = programItem.parentNode;
        }
        programItems.push(programItem);
    }

    // Get minutes date
    const minutesDate = new Date(doc.getElementById("watermark").previousElementSibling.children[0].textContent);

    // Extract debate data
    billDebates = [];
    for (const programItem of programItems) {
        let billDebate = {};

        // Get bill ID and name
        let billLink = programItem.getElementsByTagName("a")[0];
        billDebate.billId = billLink.getAttribute("href").match(/BillId%3A(.*?)%/)[1];
        billDebate.billName = billLink.textContent;

        // Get start time
        let startTime = programItem.getElementsByClassName("timeStamp")[0].textContent;
        startTime = startTime.match(/\d.*/)[0];
        startTime = parseTime(minutesDate, startTime);
        billDebate.startTimeStamp = startTime;

        // Get debate list
        let debateList = programItem.querySelector("div[style=\"margin-left:21pt\"]");
        if (debateList == null) {
            continue;
        }

        // Get debate turns
        let debateTurns = [];
        for (const pair of debateList.textContent.split(".")) {
            let couple = pair.split(",");
            if (couple.length != 2) {
                continue;
            }

            let speaker = couple[0].trim();
            
            // Skip "Point of order" entries
            if (speaker.toLowerCase() === "point of order") {
                continue;
            }
            
            // Skip if same speaker as last entry
            if (debateTurns.length > 0 && normaliseName(debateTurns[debateTurns.length - 1].speaker) === normaliseName(speaker)) {
                continue;
            }
            
            let time = parseTime(minutesDate, couple[1].trim());
            debateTurns.push({speaker: speaker, time: time});
        }
        billDebate.debateTurns = debateTurns;

        // If bill already in list
        const existingDebate = billDebates.find(({billId}) => billId === billDebate.billId);
        if (existingDebate) {
            existingDebate.debateTurns.push(...billDebate.debateTurns);
        }
        else {
            // Add to list
            billDebates.push(billDebate);
        }
    }

    // Return result
    return billDebates;
}

function fetchLiveMinutes() {
    fetch(url)
    .then(response => response.text())
    .then(data => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(data, "text/html");

        return doc;
    })
    .then(data => {
        if (data == null) {
            throw new Error("Data is null");
        }
        billDebates = parseDoc(data);
        document.getElementById("dataDump").innerHTML = JSON.stringify(billDebates);
        
        // Auto-populate on first load if no URL params
        if (isFirstLoad) {
            isFirstLoad = false;
            autoPopulateFromLastDebate();
        }
        
        estimateTime();
    })
    .catch(error => {
        console.error("Failed to fetch data:", error);
    });
}

function parseTime(date, timeString) {
    const dateString = date.toLocaleDateString("en-US");
    const dateTime = new Date(`${dateString} ${timeString}`);
    return dateTime;
}

function countDown(date) {
    const now = new Date().getTime();
    let distance = date - now;
    const negative = distance < 0;
    distance = Math.abs(distance) / 1000;

    const days = Math.floor(distance / (24 * 60 * 60));
    const hours = Math.floor((distance % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((distance % (60 * 60)) / 60);
    const seconds = Math.floor((distance % 60));

    let result = `${days}d ${hours}h ${minutes}m ${seconds}s ${negative ? " ago" : ""}`;

    // Filter out leading values that have 0
    result = result.replace(/^(0[a-zA-Z]+ )*/g, "");

    return result;
}

function normaliseName(name) {
    name = name.toLowerCase();
    name = name.trim();
    name = name.replace(/^(mr|ms|mrs|dr) /, "");
    return name;
}

function estimateTime() {
    const expectedSpeakerList = document.getElementById("speaker-list").value.split("\n").filter(line => line.trim() !== "");
    const billId = billTitleToID(document.getElementById("bill").value);
    const billDebate = billDebates.find(billDebate => billDebate.billId === billId);
    const timelineEl = document.getElementById("speaker-timeline");

    // If no speakers, show empty state
    if (expectedSpeakerList.length === 0) {
        timelineEl.innerHTML = "<div class=\"timeline-empty\">Enter speakers above to see estimated times</div>";
        return;
    }

    // If bill not found, show error
    if (billDebate == null) {
        timelineEl.innerHTML = "<div class=\"timeline-error\">Bill not found in live data</div>";
        return;
    }

    // Get last matched speaker's timestamp and index
    let lastMatchEndTime = null;
    let linesBeforeLastMatchedSpeaker = 0;
    for (let i = billDebate.debateTurns.length - 1; i >= 0; i--) {
        const speaker = billDebate.debateTurns[i].speaker;
        let matchFound = false;
        for (let j = expectedSpeakerList.length - 1; j >= 0; j--) {
            const expectedSpeaker = expectedSpeakerList[j];
            if (normaliseName(speaker) === normaliseName(expectedSpeaker)) {
                lastMatchEndTime = billDebate.debateTurns[i].time;
                matchFound = true;
                linesBeforeLastMatchedSpeaker = j;
                break;
            }
        }
        if (matchFound) {
            break;
        }
    }

    // If insufficient data, show error
    if (!lastMatchEndTime) {
        timelineEl.innerHTML = "<div class=\"timeline-error\">No matching speakers found in live data yet</div>";
        return;
    }

    // Calculate times for all speakers
    let html = "";
    
    expectedSpeakerList.forEach((speaker, index) => {
        const speakerName = speaker.trim();
        const minutesToSpeaker = 15 * (index - linesBeforeLastMatchedSpeaker);
        let expectedTime = new Date(lastMatchEndTime);
        expectedTime.setMinutes(expectedTime.getMinutes() + minutesToSpeaker);
        
        const expectedTimeText = `${expectedTime.getHours().toString().padStart(2, "0")}:${expectedTime.getMinutes().toString().padStart(2, "0")}`;
        const countdown = countDown(expectedTime);
        
        // Determine status
        let status = "";
        let statusClass = "";
        const now = new Date().getTime();
        const timeDiff = expectedTime - now;
        
        if (index <= linesBeforeLastMatchedSpeaker) {
            status = "Completed";
            statusClass = "completed";
        } else if (timeDiff < 0) {
            status = countdown;
            statusClass = "overdue";
        } else if (timeDiff < 5 * 60 * 1000) {
            status = countdown;
            statusClass = "imminent";
        } else {
            status = countdown;
            statusClass = "upcoming";
        }
        
        html += `
            <div class="speaker-item ${statusClass}">
                <div class="speaker-info">
                    <div class="speaker-name">${speakerName}</div>
                    <div class="speaker-status">${status}</div>
                </div>
                <div class="speaker-time">${expectedTimeText}</div>
            </div>
        `;
    });
    
    timelineEl.innerHTML = html;
}

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;

    // Create a 2D array
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    // Initialise base cases
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill DP table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1]; // No cost
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j], // Deletion
                    dp[i][j - 1], // Insertion
                    dp[i - 1][j - 1] // Substitution
                );
            }
        }
    }

    return dp[m][n];
}

function billTitleToID(title) {
    for (const billDebate of billDebates) {
        if (billTitleMatch(title, billDebate.billName)) {
            return billDebate.billId;
        }
    }
}

function billTitleMatch(title1, title2) {
    title1 = title1.toLowerCase().trim().replace(/ bill \d+$/, "").replaceAll(" ", "");
    title2 = title2.toLowerCase().trim().replace(/ bill \d+$/, "").replaceAll(" ", "");
    return levenshtein(title1, title2) <= 4;
}

function loadFormValuesFromURL() {
    const params = new URLSearchParams(window.location.search);
    formValues.forEach(id => {
        const value = params.get(id);
        if (value) {
            document.getElementById(id).value = value;
        }
    });
}

function autoPopulateFromLastDebate() {
    // Check if URL has any parameters
    const params = new URLSearchParams(window.location.search);
    const hasParams = params.has("bill") || params.has("speaker-list");
    
    // If params exist or no debates available, don't auto-populate
    if (hasParams || billDebates.length === 0) {
        return;
    }
    
    // Try to find the last debate with more than 1 speaker
    let selectedDebate = null;
    for (let i = billDebates.length - 1; i >= 0; i--) {
        if (billDebates[i].debateTurns && billDebates[i].debateTurns.length > 1) {
            selectedDebate = billDebates[i];
            break;
        }
    }
    
    // If no debate with multiple speakers, just use the last debate
    if (!selectedDebate) {
        selectedDebate = billDebates[billDebates.length - 1];
    }
    
    // Populate bill name
    document.getElementById("bill").value = selectedDebate.billName;
    
    // Populate speaker list from debate turns
    const speakers = selectedDebate.debateTurns.map(turn => turn.speaker).join("\n");
    document.getElementById("speaker-list").value = speakers;
    
    // Trigger estimateTime to update the timeline display
    estimateTime();
}

function copyShareLink() {
    // Generate URL with current form values
    const params = new URLSearchParams();
    formValues.forEach(id => {
        const value = document.getElementById(id).value;
        if (value) {
            params.set(id, value);
        }
    });
    const shareURL = `${window.location.pathname}?${params.toString()}`;
    
    navigator.clipboard.writeText(shareURL).then(() => {
        const btn = document.getElementById("share-btn");
        const originalText = btn.innerHTML;
        btn.innerHTML = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"20 6 9 17 4 12\"></polyline></svg> Copied!";
        btn.style.background = "rgba(125, 211, 252, 0.2)";
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = "";
        }, 2000);
    }).catch(err => {
        console.error("Failed to copy:", err);
    });
}

function cleanTextArea(textAreaId) {
    const textArea = document.getElementById(textAreaId);
    const text = textArea.value;
    const lines = text.split("\n");
    const nonBlankLines = lines.filter(line => line.trim() !== "");
    textArea.value = nonBlankLines.join("\n");

    // Send input event
    const inputEvent = new Event("input", { bubbles: true });
    textArea.dispatchEvent(inputEvent);
}

// Clean text areas when the user clicks away
formValues.forEach(id => {
    const element = document.getElementById(id);
    if (element.tagName === "TEXTAREA") {
        element.addEventListener("blur", () => cleanTextArea(id));
    }
});

// Load form values from URL parameters on page load
loadFormValuesFromURL();

// Fetch speaker history every 20 seconds (first fetch will auto-populate if no URL params)
fetchLiveMinutes();
setInterval(fetchLiveMinutes, 20_000);

// Estimate time every second
estimateTime();
setInterval(estimateTime, 1_000);

// Estimate time when form values change
formValues.forEach(id => document.getElementById(id).addEventListener("input", estimateTime));

// Share button handler
document.getElementById("share-btn").addEventListener("click", copyShareLink);
