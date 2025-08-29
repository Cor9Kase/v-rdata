// Definer global modell-API-nøkkel som Canvas gir
const apiKey = "4ba7b19ecbc359133b572722ef3bac0d";
        
// Henter UI-elementer
const salesFileEl = document.getElementById('salesFile');
const locationEl = document.getElementById('location');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const messageBox = document.getElementById('messageBox');
const loadingIndicator = document.getElementById('loadingIndicator');
const visualizationEl = document.getElementById('visualization');
const chartEl = document.getElementById('chart');
const tooltip = document.getElementById('tooltip');

// Koordinater for byer i Norge for OpenWeatherMap API
const cityCoordinates = {
    oslo: { lat: 59.9139, lon: 10.7522 },
    bergen: { lat: 60.3913, lon: 5.3221 },
    trondheim: { lat: 63.4305, lon: 10.3951 },
    stavanger: { lat: 58.9700, lon: 5.7331 },
    tromso: { lat: 69.6492, lon: 18.9553 },
    all: { lat: 64.9128, lon: 16.2755 } // Midt-Norge for representasjon av hele landet
};

let combinedData = [];

processBtn.addEventListener('click', async () => {
    const file = salesFileEl.files[0];
    if (!file) {
        showMessage('Vennligst last opp en salgsdatafil.', 'error');
        return;
    }

    setLoading(true);
    hideContent();

    try {
        // Les filen
        const rawText = await readFile(file);
        
        // Rydd opp dataen ved hjelp av Gemini API
        const cleanedData = await cleanAndParseData(rawText);
        
        if (!cleanedData || cleanedData.length === 0) {
            throw new Error("Kunne ikke parse salgsdata. Sjekk filformatet.");
        }

        // Hent og kombiner data
        const weatherData = await getWeatherData(cleanedData);
        combinedData = combineData(cleanedData, weatherData);

        // Visualiser dataen
        renderChart(combinedData);

        // Aktiver nedlasting
        downloadBtn.disabled = false;
        showMessage('Analyse fullført!', 'success');
        showContent();

    } catch (error) {
        console.error("Feil under analyse:", error);
        showMessage(`Feil: ${error.message}`, 'error');
        hideContent();
    } finally {
        setLoading(false);
    }
});

downloadBtn.addEventListener('click', () => {
    if (combinedData.length > 0) {
        downloadCSV(combinedData);
    }
});

// Hjelpefunksjon for å vise meldinger
function showMessage(message, type) {
    messageBox.textContent = message;
    messageBox.className = 'p-4 rounded-lg text-sm mb-4';
    if (type === 'error') {
        messageBox.classList.add('bg-red-100', 'text-red-700');
    } else if (type === 'success') {
        messageBox.classList.add('bg-green-100', 'text-green-700');
    }
    messageBox.classList.remove('hidden');
}

// Hjelpefunksjon for lasting-indikator
function setLoading(isLoading) {
    loadingIndicator.classList.toggle('hidden', !isLoading);
    processBtn.disabled = isLoading;
}

// Hjelpefunksjon for å vise/skjule innhold
function showContent() {
    visualizationEl.classList.remove('hidden');
}
function hideContent() {
    visualizationEl.classList.add('hidden');
}

// Funksjon for å lese filen
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

// Funksjon for å rense og parse data ved hjelp av Gemini API
async function cleanAndParseData(rawText) {
    const prompt = `Gitt den rotete eller uformelle teksten nedenfor, parse ut salgsdata og formater den som en JSON-array. Hvert element i arrayen skal ha en "date" (dato i YYYY-MM-DD-format) og en "sales" (salgstall) eiendom. Datoen skal være den første dagen i måneden eller uken hvis dataen er per uke. Eksempel på JSON-format: [{"date": "2023-01-01", "sales": 15000}, {"date": "2023-02-01", "sales": 18000}]. Her er teksten:\n\n${rawText}`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        "date": { "type": "STRING" },
                        "sales": { "type": "NUMBER" }
                    },
                    "propertyOrdering": ["date", "sales"]
                }
            }
        }
    };
    
    // Simulerer eksponensiell tilbakeslag for API-kall
    let backoff = 1000;
    for (let i = 0; i < 5; i++) {
        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                if (response.status === 429) { // For mange forespørsler
                    throw new Error('Retrying due to rate limit');
                }
                throw new Error(`API-feil: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (jsonText) {
                return JSON.parse(jsonText);
            }
            throw new Error("Ingen gyldig JSON-respons fra Gemini.");
        } catch (e) {
            if (e.message.includes('Retrying')) {
                await new Promise(res => setTimeout(res, backoff));
                backoff *= 2;
            } else {
                throw e;
            }
        }
    }
    throw new Error("Klarte ikke å behandle data etter flere forsøk.");
}

// Funksjon for å hente værdata fra OpenWeatherMap API
async function getWeatherData(salesData) {
    const locationKey = locationEl.value;
    const coords = cityCoordinates[locationKey];
    const API_KEY = "YOUR_API_KEY_HERE"; // <<-- Sett inn din API-nøkkel her
    
    if (API_KEY === "YOUR_API_KEY_HERE" || !coords) {
        throw new Error("Vennligst oppgi en gyldig OpenWeatherMap API-nøkkel i script.js og velg et gyldig område.");
    }

    const fetchPromises = salesData.map(d => {
        const date = new Date(d.date);
        const unixTime = Math.floor(date.getTime() / 1000);
        
        const apiUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${coords.lat}&lon=${coords.lon}&dt=${unixTime}&appid=${API_KEY}&units=metric&lang=no`;
        
        return fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Nettverksfeil for dato ${d.date}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.data && data.data.length > 0) {
                    const weather = data.data[0];
                    return {
                        date: d.date,
                        temp: weather.temp,
                        description: weather.weather[0].description
                    };
                }
                throw new Error("Ingen værdata funnet for denne datoen.");
            });
    });

    return Promise.all(fetchPromises)
        .catch(error => {
            console.error("Feil ved henting av værdata:", error);
            throw new Error("Kunne ikke hente værdata. Sjekk API-nøkkel og tilkobling.");
        });
}

// Funksjon for å kombinere salgs- og værdata
function combineData(salesData, weatherData) {
    return salesData.map(salesItem => {
        const weatherItem = weatherData.find(w => w.date === salesItem.date);
        return {
            date: salesItem.date,
            sales: salesItem.sales,
            temp: weatherItem ? weatherItem.temp : null,
            description: weatherItem ? weatherItem.description : null
        };
    });
}

// Funksjon for å visualisere data med D3.js
function renderChart(data) {
    // Lag en kopi av dataen for å unngå å mutere den originale arrayen
    const chartData = JSON.parse(JSON.stringify(data));

    chartEl.innerHTML = '';
    
    const margin = { top: 20, right: 20, bottom: 60, left: 60 };
    const width = chartEl.clientWidth - margin.left - margin.right;
    const height = chartEl.clientHeight - margin.top - margin.bottom;

    const svg = d3.select(chartEl).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    const parseDate = d3.timeParse("%Y-%m-%d");
    chartData.forEach(d => d.date = parseDate(d.date));

    const x = d3.scaleTime()
        .domain(d3.extent(chartData, d => d.date))
        .range([0, width]);
    
    const ySales = d3.scaleLinear()
        .domain([0, d3.max(chartData, d => d.sales) * 1.1])
        .range([height, 0]);

    const yWeather = d3.scaleLinear()
        .domain(d3.extent(chartData, d => d.temp).map((val, i) => {
            // Utvid rekkevidden med 10% på en måte som fungerer for negative tall
            return i === 0 ? val * 1.1 - 1 : val * 1.1 + 1;
        }))
        .range([height, 0]);

    const lineSales = d3.line()
        .x(d => x(d.date))
        .y(d => ySales(d.sales));

    const lineTemp = d3.line()
        .x(d => x(d.date))
        .y(d => yWeather(d.temp));

    // Akser
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x));

    svg.append("g")
        .call(d3.axisLeft(ySales))
        .append("text")
        .attr("fill", "#6b7280")
        .attr("transform", "rotate(-90)")
        .attr("y", -50)
        .attr("x", -height / 2)
        .attr("dy", "1em")
        .attr("text-anchor", "middle")
        .text("Salgstall");
    
    svg.append("g")
        .attr("transform", `translate(${width}, 0)`)
        .call(d3.axisRight(yWeather))
        .append("text")
        .attr("fill", "#6b7280")
        .attr("transform", "rotate(90)")
        .attr("y", -40)
        .attr("x", height / 2)
        .attr("dy", "1em")
        .attr("text-anchor", "middle")
        .text("Temperatur (°C)");

    // Linjer
    svg.append("path")
        .datum(chartData)
        .attr("class", "sales-line")
        .attr("fill", "none")
        .attr("stroke", "#3b82f6")
        .attr("stroke-width", 2)
        .attr("d", lineSales);
    
    svg.append("path")
        .datum(chartData)
        .attr("class", "temp-line")
        .attr("fill", "none")
        .attr("stroke", "#f59e0b")
        .attr("stroke-width", 2)
        .attr("d", lineTemp);

    // Verktøytips
    const focus = svg.append("g")
        .style("display", "none");
    
    focus.append("line")
        .attr("class", "x-hover-line hover-line")
        .attr("stroke", "#9ca3af")
        .attr("stroke-dasharray", "3,3")
        .attr("y1", 0)
        .attr("y2", height);

    focus.append("circle")
        .attr("class", "focus-circle-sales")
        .attr("r", 5)
        .attr("fill", "#3b82f6")
        .attr("stroke", "white");
    
    focus.append("circle")
        .attr("class", "focus-circle-temp")
        .attr("r", 5)
        .attr("fill", "#f59e0b")
        .attr("stroke", "white");

    svg.append("rect")
        .attr("class", "overlay")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => focus.style("display", null))
        .on("mouseout", () => focus.style("display", "none"))
        .on("mousemove", mousemove);

    function mousemove(event) {
        const bisectDate = d3.bisector(d => d.date).left;
        const x0 = x.invert(d3.pointer(event)[0]);
        const i = bisectDate(chartData, x0, 1);
        const d0 = chartData[i - 1];
        const d1 = chartData[i];
        const d = x0 - d0.date > d1.date - x0 ? d1 : d0;
        
        focus.select(".focus-circle-sales")
            .attr("transform", `translate(${x(d.date)},${ySales(d.sales)})`);
        focus.select(".focus-circle-temp")
            .attr("transform", `translate(${x(d.date)},${yWeather(d.temp)})`);
        focus.select(".x-hover-line").attr("transform", `translate(${x(d.date)}, 0)`);
        
        const formatTooltipDate = d3.timeFormat("%b %d, %Y");
        tooltip.style("display", "block")
            .style("left", `${event.pageX + 10}px`)
            .style("top", `${event.pageY - 28}px`)
            .html(`Dato: ${formatTooltipDate(d.date)}<br>Salg: ${d.sales.toLocaleString('no-NO')}<br>Temp: ${d.temp}°C<br>Vær: ${d.description || 'N/A'}`);
    }
}

// Funksjon for å laste ned data som CSV
function downloadCSV(data) {
    const header = Object.keys(data[0]).join(',');
    const csv = data.map(row => Object.values(row).join(',')).join('\n');
    const blob = new Blob([header + '\n' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', 'vær_salgsdata.csv');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
