const THEME_STORAGE_KEY = 'skyai-theme';
const THEME_DEFAULTS = {
    ocean: '#76f2cc',
    sunset: '#ffbf69',
    forest: '#98f5a8',
    night: '#b8c7ff',
};

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('weather-form');
    const cityInput = document.getElementById('city');
    const suggestionsBox = document.getElementById('city-suggestions');
    const dateInput = document.getElementById('date');
    const resultDiv = document.getElementById('result');
    const loader = document.getElementById('loader');
    const themeOptions = document.getElementById('theme-options');
    const accentColor = document.getElementById('accent-color');
    const resetTheme = document.getElementById('reset-theme');
    let selectedCity = null;
    let citySuggestions = [];
    let activeSuggestionIndex = -1;
    let suggestionTimer = null;
    let searchController = null;

    initTheme(themeOptions, accentColor);
    dateInput.value = formatDate(new Date());

    themeOptions.addEventListener('click', (event) => {
        const swatch = event.target.closest('.theme-swatch');
        if (!swatch) {
            return;
        }

        applyTheme({
            theme: swatch.dataset.theme,
            accent: THEME_DEFAULTS[swatch.dataset.theme],
        }, themeOptions, accentColor);
    });

    accentColor.addEventListener('input', () => {
        const settings = getCurrentThemeSettings(accentColor);
        settings.accent = accentColor.value;
        applyTheme(settings, themeOptions, accentColor);
    });

    resetTheme.addEventListener('click', () => {
        localStorage.removeItem(THEME_STORAGE_KEY);
        applyTheme({ theme: 'ocean', accent: THEME_DEFAULTS.ocean }, themeOptions, accentColor);
    });

    cityInput.addEventListener('input', () => {
        selectedCity = null;
        activeSuggestionIndex = -1;
        queueCitySearch(cityInput.value.trim());
    });

    cityInput.addEventListener('keydown', (event) => {
        if (suggestionsBox.classList.contains('hidden')) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveSuggestion(activeSuggestionIndex + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveSuggestion(activeSuggestionIndex - 1);
        } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
            event.preventDefault();
            selectCity(citySuggestions[activeSuggestionIndex]);
        } else if (event.key === 'Escape') {
            hideSuggestions();
        }
    });

    cityInput.addEventListener('blur', () => {
        window.setTimeout(hideSuggestions, 150);
    });

    suggestionsBox.addEventListener('pointerdown', (event) => {
        const option = event.target.closest('.suggestion-option');
        if (!option) {
            return;
        }

        event.preventDefault();
        selectCity(citySuggestions[Number(option.dataset.index)]);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const city = cityInput.value.trim();
        const date = dateInput.value;

        if (!city || !date) {
            renderMessage(resultDiv, 'Please enter both a city and a date.', true);
            return;
        }

        setLoading(loader, resultDiv, true);

        try {
            const response = await requestForecast(city, date, selectedCity);
            const data = await parseJsonResponse(response);

            if (!response.ok) {
                throw new Error(data.error || 'Unable to fetch this forecast.');
            }

            renderForecast(resultDiv, data);
        } catch (error) {
            renderMessage(resultDiv, error.message || 'Error fetching the weather. Try again.', true);
        } finally {
            setLoading(loader, resultDiv, false);
        }
    });

    function queueCitySearch(query) {
        window.clearTimeout(suggestionTimer);

        if (searchController) {
            searchController.abort();
            searchController = null;
        }

        if (query.length < 2) {
            hideSuggestions();
            return;
        }

        suggestionTimer = window.setTimeout(async () => {
            try {
                searchController = new AbortController();
                const response = await requestCitySuggestions(query, searchController.signal);
                const data = await parseJsonResponse(response);

                if (!response.ok) {
                    throw new Error(data.error || 'Could not search cities.');
                }

                if (cityInput.value.trim() === query) {
                    renderCitySuggestions(data.cities || []);
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    hideSuggestions();
                }
            } finally {
                searchController = null;
            }
        }, 250);
    }

    function renderCitySuggestions(cities) {
        citySuggestions = cities;
        activeSuggestionIndex = -1;

        if (!cities.length) {
            hideSuggestions();
            return;
        }

        suggestionsBox.innerHTML = cities.map((city, index) => `
            <button
                type="button"
                class="suggestion-option"
                id="city-suggestion-${index}"
                role="option"
                data-index="${index}"
                aria-selected="false"
            >
                <span>${escapeHtml(city.name)}</span>
                <small>${escapeHtml(cityDetails(city))}</small>
            </button>
        `).join('');
        suggestionsBox.classList.remove('hidden');
        cityInput.setAttribute('aria-expanded', 'true');
    }

    function selectCity(city) {
        if (!city) {
            return;
        }

        selectedCity = city;
        cityInput.value = city.label || city.name;
        hideSuggestions();
    }

    function setActiveSuggestion(nextIndex) {
        if (!citySuggestions.length) {
            return;
        }

        activeSuggestionIndex = (nextIndex + citySuggestions.length) % citySuggestions.length;
        suggestionsBox.querySelectorAll('.suggestion-option').forEach((option, index) => {
            const isActive = index === activeSuggestionIndex;
            option.classList.toggle('active', isActive);
            option.setAttribute('aria-selected', String(isActive));
        });
        cityInput.setAttribute('aria-activedescendant', `city-suggestion-${activeSuggestionIndex}`);
    }

    function hideSuggestions() {
        suggestionsBox.classList.add('hidden');
        suggestionsBox.innerHTML = '';
        citySuggestions = [];
        activeSuggestionIndex = -1;
        cityInput.setAttribute('aria-expanded', 'false');
        cityInput.removeAttribute('aria-activedescendant');
    }
});

async function requestForecast(city, date, location) {
    if (isLikelyStaticServer()) {
        try {
            return await postForecast('http://127.0.0.1:5000/get_forecast', city, date, location);
        } catch (error) {
            throw new Error('Could not reach Flask. Start app.py and open http://127.0.0.1:5000/.');
        }
    }

    return postForecast('/get_forecast', city, date, location);
}

function postForecast(url, city, date, location) {
    const body = { city, date };

    if (location) {
        body.location = location;
    }

    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function requestCitySuggestions(query, signal) {
    const baseUrl = isLikelyStaticServer()
        ? 'http://127.0.0.1:5000/search_cities'
        : '/search_cities';
    const url = `${baseUrl}?q=${encodeURIComponent(query)}`;
    return fetch(url, { signal });
}

function isLikelyStaticServer() {
    const localHostnames = ['localhost', '127.0.0.1'];
    return window.location.protocol === 'file:' ||
        (localHostnames.includes(window.location.hostname) && window.location.port !== '5000');
}

async function parseJsonResponse(response) {
    const text = await response.text();

    if (!text.trim()) {
        if (!response.ok) {
            if (response.status === 405) {
                throw new Error('The page is not being served by Flask. Start app.py and open http://127.0.0.1:5000/.');
            }
            throw new Error(`Server returned ${response.status} with no error details.`);
        }
        throw new Error('The server returned an empty response.');
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}, but not JSON. Check the Flask terminal.`);
        }
        throw new Error('The server returned invalid JSON.');
    }
}

function setLoading(loader, resultDiv, isLoading) {
    loader.classList.toggle('hidden', !isLoading);
    resultDiv.classList.toggle('is-loading', isLoading);
}

function renderForecast(container, data) {
    const temp = data.temperature || {};
    const wind = data.wind || {};
    const rain = data.precipitation || {};
    const airQuality = data.air_quality || {};

    container.className = `result-card ${themeClass(data.condition)}`;
    container.innerHTML = `
        <div class="forecast-head">
            <div>
                <p class="eyebrow">${escapeHtml(data.source)}</p>
                <h2>${escapeHtml(data.condition)}</h2>
                <p>${escapeHtml(data.location)} - ${escapeHtml(formatDisplayDate(data.date))}</p>
            </div>
        </div>

        <div class="metrics">
            ${metric('High / Low', `${formatValue(temp.max)} / ${formatValue(temp.min)}`, 'C')}
            ${metric('Feels like', `${formatValue(temp.feels_max)} / ${formatValue(temp.feels_min)}`, 'C')}
            ${metric('Wind', `${formatValue(wind.speed)} ${escapeHtml(wind.direction || '')}`, 'km/h')}
            ${metric('Rain', `${formatValue(rain.sum)}`, 'mm')}
            ${metric('Max AQI', airQuality.available ? `${formatValue(airQuality.value)} ${airQuality.category || ''}` : 'Unavailable', 'US AQI')}
        </div>

        ${airQualityPanel(airQuality)}

        <p class="recommendation">${escapeHtml(data.recommendation)}</p>
    `;
}

function airQualityPanel(airQuality) {
    if (!airQuality.available) {
        return `
            <div class="aqi-panel unavailable">
                <div>
                <span>Air quality</span>
                <strong>AQI unavailable</strong>
                    <p>${escapeHtml(airQuality.message || 'AQI data is not available for this date.')}</p>
                </div>
            </div>
        `;
    }

    return `
        <div class="aqi-panel ${aqiClass(airQuality.value)}">
            <div>
                <span>Daily max US AQI</span>
                <strong>${escapeHtml(formatValue(airQuality.value))} ${escapeHtml(airQuality.category)}</strong>
                <p>${escapeHtml(airQuality.advice)}</p>
            </div>
            <div class="pollutants">
                <span>Avg PM2.5 ${escapeHtml(formatValue(airQuality.pm2_5))} ug/m3</span>
                <span>Avg PM10 ${escapeHtml(formatValue(airQuality.pm10))} ug/m3</span>
            </div>
        </div>
    `;
}

function renderMessage(container, message, isError = false) {
    container.className = `result-card empty${isError ? ' error' : ''}`;
    container.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function metric(label, value, unit) {
    return `
        <article class="metric">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)} <small>${escapeHtml(unit)}</small></strong>
        </article>
    `;
}

function cityDetails(city) {
    return [city.admin1, city.country].filter(Boolean).join(', ');
}

function initTheme(themeOptions, accentColor) {
    const savedTheme = loadThemeSettings();
    applyTheme(savedTheme, themeOptions, accentColor, false);
}

function loadThemeSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
        const theme = THEME_DEFAULTS[saved?.theme] ? saved.theme : 'ocean';
        const accent = isHexColor(saved?.accent) ? saved.accent : THEME_DEFAULTS[theme];
        return { theme, accent };
    } catch (error) {
        return { theme: 'ocean', accent: THEME_DEFAULTS.ocean };
    }
}

function getCurrentThemeSettings(accentColor) {
    const theme = document.body.dataset.theme || 'ocean';
    return {
        theme,
        accent: accentColor.value || THEME_DEFAULTS[theme],
    };
}

function applyTheme(settings, themeOptions, accentColor, shouldSave = true) {
    const theme = THEME_DEFAULTS[settings.theme] ? settings.theme : 'ocean';
    const accent = isHexColor(settings.accent) ? settings.accent : THEME_DEFAULTS[theme];

    document.body.dataset.theme = theme;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.16));
    document.documentElement.style.setProperty('--accent-ring', hexToRgba(accent, 0.34));
    document.documentElement.style.setProperty('--accent-text', readableTextColor(accent));
    accentColor.value = accent;

    themeOptions.querySelectorAll('.theme-swatch').forEach((button) => {
        const isActive = button.dataset.theme === theme;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });

    if (shouldSave) {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, accent }));
    }
}

function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value || '');
}

function hexToRgba(hex, alpha) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function readableTextColor(hex) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    return luminance > 0.62 ? '#10202b' : '#ffffff';
}

function formatValue(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '--';
    }

    const rounded = Number(value).toFixed(1);
    return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded;
}

function formatDate(date) {
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function themeClass(condition = '') {
    const text = condition.toLowerCase();

    if (text.includes('thunder') || text.includes('rain') || text.includes('drizzle')) {
        return 'rainy';
    }

    if (text.includes('snow')) {
        return 'snowy';
    }

    if (text.includes('fog') || text.includes('cloud') || text.includes('overcast')) {
        return 'cloudy';
    }

    return 'clear';
}

function aqiClass(value) {
    if (value <= 50) {
        return 'aqi-good';
    }

    if (value <= 100) {
        return 'aqi-moderate';
    }

    if (value <= 150) {
        return 'aqi-sensitive';
    }

    if (value <= 200) {
        return 'aqi-unhealthy';
    }

    return 'aqi-hazardous';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}
