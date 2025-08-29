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
  stavanger: { lat: 58.97, lon: 5.7331 },
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
  downloadBtn.disabled = true;

  try {
    // Les og parse filen lokalt
    const parsedData = await parseFile(file);
    if (!parsedData || parsedData.length === 0) {
      throw new Error("Kunne ikke parse salgsdata. Sjekk filformatet.");
    }

    // Hent og kombiner data
    const weatherData = await getWeatherData(parsedData);
    combinedData = combineData(parsedData, weatherData);

    // Vis innhold før vi tegner (ellers blir width/height = 0)
    showContent();

    // Visualiser dataen
    renderChart(combinedData);

    // Aktiver nedlasting
    downloadBtn.disabled = false;
    showMessage('Analyse fullført!', 'success');
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

// Funksjon for å parse fil lokalt
async function parseFile(file) {
  const text = await readFile(file);
  if (file.name.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data) || !data.every(item => 'date' in item && 'sales' in item)) {
        throw new Error('JSON-data er ikke i riktig format. Forventer et array av objekter med "date" og "sales".');
      }
      return data;
    } catch (e) {
      throw new Error(`Ugyldig JSON-fil: ${e.message}`);
    }
  } else if (file.name.endsWith('.csv')) {
    try {
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const dateIndex = header.indexOf('date');
      const salesIndex = header.indexOf('sales');
      if (dateIndex === -1 || salesIndex === -1) {
        throw new Error('CSV-filen må inneholde "date" og "sales" kolonner.');
      }
      return lines.slice(1).map(line => {
        const values = line.split(',');
        return {
          date: values[dateIndex].trim(),
          sales: parseFloat(values[salesIndex].trim())
        };
      });
    } catch (e) {
      throw new Error(`Feil ved parsing av CSV: ${e.message}`);
    }
  } else {
    throw new Error("Ugyldig filtype. Vennligst bruk CSV eller JSON.");
  }
}

// === OpenWeather ===

// ⚠️ Ligger i frontend; vurder å skjule denne bak en enkel server-proxy.
const OPENWEATHER_API_KEY = "73dbe6c19dc2ed54d9ec894dcbb250f0";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Hent værdata med batching + retries + filtrering av framtidsdatoer (> +4 dager)
async function getWeatherData(salesData) {
  const locationKey = locationEl.value;
  const coords = cityCoordinates[locationKey];

  if (!OPENWEATHER_API_KEY || !coords) {
    throw new Error("Vennligst oppgi en gyldig OpenWeatherMap API-nøkkel og velg et gyldig område.");
  }

  // Tillatt vindu for timemachine: historikk og opptil ~+4 dager fra nå (UTC)
  const nowUTC = new Date();
  const maxFutureUTC = new Date(Date.UTC(
    nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate() + 4
  ));

  // Dedupér datoer
  const uniqueDates = Array.from(new Set(
    salesData.map(d => (d?.date || '').trim()).filter(Boolean)
  ));

  const BATCH = 10;
  const SLEEP_MS = 1200;
  const resultsByDate = {};

  const fetchOne = async (dateStr) => {
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) {
      return { date: dateStr, temp: null, description: null, error: 'Ugyldig dato' };
    }
    if (dt > maxFutureUTC) {
      return { date: dateStr, temp: null, description: null,
        error: 'Dato er for langt frem i tid for timemachine (maks ~4 dager).' };
    }

    const unixTime = Math.floor(dt.getTime() / 1000);
    const url = `https://api.openweathermap.org/data/3.0/onecall/timemachine` +
      `?lat=${coords.lat}&lon=${coords.lon}&dt=${unixTime}` +
      `&units=metric&lang=no&appid=${OPENWEATHER_API_KEY}`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url);
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch {}

        if (!res.ok) {
          if (res.status === 401) {
            const msg = (json && (json.message || json.cod)) ? ` - ${json.message || json.cod}` : '';
            return { date: dateStr, temp: null, description: null,
              error: `401 Unauthorized${msg}. Sjekk nøkkel og at One Call 3.0 er aktivt.` };
          }
          if (res.status === 429 || res.status >= 500) {
            if (attempt === MAX_RETRIES) {
              return { date: dateStr, temp: null, description: null,
                error: `${res.status} ${res.statusText} (etter retries)` };
            }
            await sleep(800 * (attempt + 1));
            continue;
          }
          const msg = (json && (json.message || json.cod)) ? ` - ${json.message || json.cod}` : '';
          return { date: dateStr, temp: null, description: null,
            error: `${res.status} ${res.statusText}${msg}` };
        }

        const data = json || {};
        if (Array.isArray(data.data) && data.data.length > 0) {
          const w = data.data[0];
          const temp = typeof w.temp === 'number' ? w.temp : null;
          const desc = w.weather?.[0]?.description ?? null;
          return { date: dateStr, temp, description: desc };
        }
        return { date: dateStr, temp: null, description: null, error: 'Ingen værdata for denne datoen.' };
      } catch (e) {
        if (attempt === MAX_RETRIES) {
          return { date: dateStr, temp: null, description: null, error: e.message || 'Nettverksfeil' };
        }
        await sleep(800 * (attempt + 1));
      }
    }
  };

  for (let i = 0; i < uniqueDates.length; i += BATCH) {
    const chunk = uniqueDates.slice(i, i + BATCH);
    const chunkResults = await Promise.all(chunk.map(fetchOne));
    chunkResults.forEach(r => { resultsByDate[r.date] = r; });
    await sleep(SLEEP_MS);
  }

  // Returner i samme rekkefølge som salgsdataene
  return salesData.map(d => resultsByDate[d.date] || { date: d.date, temp: null, description: null });
}

// Kombiner salgs- og værdata
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

// Visualisering med D3
function renderChart(data) {
  const chartData = JSON.parse(JSON.stringify(data));
  chartEl.innerHTML = '';

  const margin = { top: 20, right: 20, bottom: 60, left: 60 };
  const rect = chartEl.getBoundingClientRect();
  const innerW = (rect.width || chartEl.clientWidth || 680) - margin.left - margin.right;
  const innerH = (rect.height || chartEl.clientHeight || 380) - margin.top - margin.bottom;
  const width = Math.max(600, innerW);
  const height = Math.max(300, innerH);

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

  const temps = chartData.map(d => d.temp).filter(t => typeof t === 'number' && !isNaN(t));
  let [tMin, tMax] = temps.length ? d3.extent(temps) : [0, 1];
  const pad = Math.max((tMax - tMin) * 0.1, 1);
  tMin -= pad; tMax += pad;

  const yWeather = d3.scaleLinear()
    .domain([tMin, tMax])
    .range([height, 0]);

  const lineSales = d3.line()
    .defined(d => typeof d.sales === 'number' && !isNaN(d.sales))
    .x(d => x(d.date))
    .y(d => ySales(d.sales));

  const lineTemp = d3.line()
    .defined(d => typeof d.temp === 'number' && !isNaN(d.temp))
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

  const hasTemps = chartData.some(d => typeof d.temp === 'number' && !isNaN(d.temp));
  if (hasTemps) {
    svg.append("path")
      .datum(chartData)
      .attr("class", "temp-line")
      .attr("fill", "none")
      .attr("stroke", "#f59e0b")
      .attr("stroke-width", 2)
      .attr("d", lineTemp);
  }

  // Verktøytips
  const focus = svg.append("g").style("display", "none");

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
    const d1 = chartData[i] || d0;
    const d = !d0 ? d1 : (x0 - d0.date > d1.date - x0 ? d1 : d0);

    if (!d) return;

    if (typeof d.sales === 'number' && !isNaN(d.sales)) {
      focus.select(".focus-circle-sales")
        .attr("transform", `translate(${x(d.date)},${ySales(d.sales)})`);
    }
    if (typeof d.temp === 'number' && !isNaN(d.temp)) {
      focus.select(".focus-circle-temp")
        .attr("transform", `translate(${x(d.date)},${yWeather(d.temp)})`);
    }
    focus.select(".x-hover-line").attr("transform", `translate(${x(d.date)}, 0)`);

    const formatTooltipDate = d3.timeFormat("%b %d, %Y");
    tooltip.style("display", "block")
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY - 28}px`)
      .html(
        `Dato: ${formatTooltipDate(d.date)}<br>` +
        `Salg: ${Number(d.sales).toLocaleString('no-NO')}<br>` +
        `Temp: ${typeof d.temp === 'number' ? d.temp : 'N/A'}°C<br>` +
        `Vær: ${d.description || 'N/A'}`
      );
  }
}

// Last ned CSV
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
