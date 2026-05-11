from datetime import date, datetime, timedelta

import requests


GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
REQUEST_TIMEOUT = 12
AQI_MIN_DATE = date(2022, 8, 1)
AQI_FORECAST_LIMIT_DAYS = 5

DAILY_FIELDS = (
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "apparent_temperature_max",
    "apparent_temperature_min",
    "precipitation_sum",
    "precipitation_hours",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
    "wind_direction_10m_dominant",
)

AIR_QUALITY_FIELDS = (
    "us_aqi",
    "pm2_5",
    "pm10",
)

WEATHER_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


class WeatherLookupError(Exception):
    """Raised when a weather lookup cannot return a user-facing result."""


def search_cities(query, count=6):
    query = (query or "").strip()
    if len(query) < 2:
        return []

    data = _get_json(
        GEOCODE_URL,
        {
            "name": query,
            "count": max(1, min(int(count), 10)),
            "language": "en",
            "format": "json",
        },
    )
    suggestions = []
    for result in data.get("results") or []:
        suggestion = _city_suggestion(result)
        if suggestion:
            suggestions.append(suggestion)
    return suggestions


def get_weather(city, date_value, location=None):
    requested_date = _parse_date(date_value)
    today = date.today()

    if requested_date < date(1940, 1, 1):
        raise WeatherLookupError("Historical weather is available from 1940 onward.")

    forecast_limit = today + timedelta(days=16)
    if requested_date > forecast_limit:
        raise WeatherLookupError(
            f"Forecasts are available up to {forecast_limit.isoformat()}. "
            "Choose a nearer date."
        )

    location = _normalize_location(location) or _geocode_city(city)
    is_historical = requested_date < today
    weather_data = _fetch_daily_weather(location, requested_date, is_historical)
    forecast = _build_forecast(location, requested_date, weather_data, is_historical)
    forecast["air_quality"] = _fetch_air_quality(location, requested_date)
    return forecast


def _parse_date(date_value):
    try:
        return datetime.strptime(date_value, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise WeatherLookupError("Please choose a valid date.") from exc


def _geocode_city(city):
    city = (city or "").strip()
    if not city:
        raise WeatherLookupError("Please enter a city.")

    data = _get_json(
        GEOCODE_URL,
        {
            "name": city,
            "count": 1,
            "language": "en",
            "format": "json",
        },
    )
    results = data.get("results") or []
    if not results:
        raise WeatherLookupError(f"No matching city was found for '{city}'.")
    return results[0]


def _city_suggestion(location):
    normalized = _normalize_location(location)
    if not normalized:
        return None

    return {
        "id": location.get("id"),
        "name": normalized["name"],
        "label": _format_location(normalized),
        "admin1": normalized.get("admin1"),
        "country": normalized.get("country"),
        "latitude": normalized["latitude"],
        "longitude": normalized["longitude"],
        "timezone": normalized.get("timezone"),
    }


def _normalize_location(location):
    if not isinstance(location, dict):
        return None

    name = (location.get("name") or location.get("label") or "").strip()
    if not name:
        return None

    try:
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])
    except (KeyError, TypeError, ValueError):
        return None

    return {
        "name": name,
        "admin1": location.get("admin1"),
        "country": location.get("country"),
        "latitude": latitude,
        "longitude": longitude,
        "timezone": location.get("timezone") or "auto",
    }


def _fetch_daily_weather(location, requested_date, is_historical):
    endpoint = ARCHIVE_URL if is_historical else FORECAST_URL
    params = {
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "daily": ",".join(DAILY_FIELDS),
        "timezone": location.get("timezone") or "auto",
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "start_date": requested_date.isoformat(),
        "end_date": requested_date.isoformat(),
    }
    return _get_json(endpoint, params)


def _fetch_air_quality(location, requested_date):
    today = date.today()
    forecast_limit = today + timedelta(days=AQI_FORECAST_LIMIT_DAYS)

    if requested_date < AQI_MIN_DATE:
        return _unavailable_air_quality("AQI data is available from August 2022 onward.")

    if requested_date > forecast_limit:
        return _unavailable_air_quality("AQI forecasts are usually available for about 5 days.")

    params = {
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "hourly": ",".join(AIR_QUALITY_FIELDS),
        "timezone": location.get("timezone") or "auto",
        "start_date": requested_date.isoformat(),
        "end_date": requested_date.isoformat(),
        "domains": "auto",
    }

    try:
        data = _get_json(AIR_QUALITY_URL, params)
        return _build_air_quality(data, requested_date)
    except WeatherLookupError as exc:
        return _unavailable_air_quality(str(exc))


def _get_json(url, params):
    try:
        response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        raise WeatherLookupError(
            "The weather service is not reachable right now. Please try again."
        ) from exc
    except ValueError as exc:
        raise WeatherLookupError("The weather service returned an invalid response.") from exc

    if data.get("error"):
        raise WeatherLookupError(data.get("reason") or "The weather service rejected this request.")
    return data


def _build_air_quality(data, requested_date):
    hourly = data.get("hourly") or {}
    indexes = _hour_indexes(hourly, requested_date)
    aqi_values = _hour_values(hourly, "us_aqi", indexes)

    if not aqi_values:
        return _unavailable_air_quality("No AQI data was returned for this date.")

    max_aqi = max(aqi_values)
    pm2_5_avg = _average(_hour_values(hourly, "pm2_5", indexes))
    pm10_avg = _average(_hour_values(hourly, "pm10", indexes))
    category = _aqi_category(max_aqi)

    return {
        "available": True,
        "value": _round_value(max_aqi, 0),
        "category": category,
        "pm2_5": _round_value(pm2_5_avg),
        "pm10": _round_value(pm10_avg),
        "advice": _aqi_advice(max_aqi, category),
    }


def _build_forecast(location, requested_date, weather_data, is_historical):
    daily = weather_data.get("daily") or {}
    index = _daily_index(daily, requested_date)

    weather_code = _daily_value(daily, "weather_code", index)
    condition = WEATHER_CODES.get(weather_code, "Weather data available")
    temp_max = _daily_value(daily, "temperature_2m_max", index)
    temp_min = _daily_value(daily, "temperature_2m_min", index)
    feels_max = _daily_value(daily, "apparent_temperature_max", index)
    feels_min = _daily_value(daily, "apparent_temperature_min", index)
    precipitation = _daily_value(daily, "precipitation_sum", index)
    precipitation_hours = _daily_value(daily, "precipitation_hours", index)
    wind_speed = _daily_value(daily, "wind_speed_10m_max", index)
    gust_speed = _daily_value(daily, "wind_gusts_10m_max", index)
    wind_degrees = _daily_value(daily, "wind_direction_10m_dominant", index)

    return {
        "location": _format_location(location),
        "date": requested_date.isoformat(),
        "source": "Historical weather" if is_historical else "Forecast",
        "condition": condition,
        "temperature": {
            "max": _round_value(temp_max),
            "min": _round_value(temp_min),
            "feels_max": _round_value(feels_max),
            "feels_min": _round_value(feels_min),
        },
        "precipitation": {
            "sum": _round_value(precipitation),
            "hours": _round_value(precipitation_hours),
        },
        "wind": {
            "speed": _round_value(wind_speed),
            "gust": _round_value(gust_speed),
            "direction_degrees": _round_value(wind_degrees, 0),
            "direction": _wind_compass(wind_degrees),
        },
        "recommendation": _recommendation(temp_max, precipitation, wind_speed, condition),
    }


def _hour_indexes(hourly, requested_date):
    requested = requested_date.isoformat()
    times = hourly.get("time") or []
    indexes = [
        index
        for index, timestamp in enumerate(times)
        if str(timestamp).startswith(requested)
    ]

    if not indexes:
        raise WeatherLookupError("No AQI data was returned for this date.")
    return indexes


def _hour_values(hourly, key, indexes):
    values = hourly.get(key) or []
    clean_values = []

    for index in indexes:
        if index < len(values) and values[index] is not None:
            clean_values.append(float(values[index]))
    return clean_values


def _daily_index(daily, requested_date):
    times = daily.get("time") or []
    if not times:
        raise WeatherLookupError("No weather data was returned for this date.")

    requested = requested_date.isoformat()
    try:
        return times.index(requested)
    except ValueError as exc:
        raise WeatherLookupError("No weather data was returned for this date.") from exc


def _daily_value(daily, key, index):
    values = daily.get(key) or []
    if index >= len(values):
        return None
    return values[index]


def _round_value(value, digits=1):
    if value is None:
        return None
    return round(float(value), digits)


def _average(values):
    if not values:
        return None
    return sum(values) / len(values)


def _unavailable_air_quality(message):
    return {
        "available": False,
        "message": message,
    }


def _aqi_category(value):
    if value <= 50:
        return "Good"
    if value <= 100:
        return "Moderate"
    if value <= 150:
        return "Unhealthy for sensitive groups"
    if value <= 200:
        return "Unhealthy"
    if value <= 300:
        return "Very unhealthy"
    return "Hazardous"


def _aqi_advice(value, category):
    if value <= 50:
        return "Air quality looks good for normal outdoor plans."
    if value <= 100:
        return "Air is acceptable, but very sensitive people may want to take it easier."
    if value <= 150:
        return "Sensitive groups should reduce long or heavy outdoor activity."
    if value <= 200:
        return "Limit prolonged outdoor activity and consider a mask if you are sensitive."
    if value <= 300:
        return "Avoid heavy outdoor activity where possible."
    return "Stay indoors as much as possible and keep windows closed."


def _format_location(location):
    parts = [location.get("name")]
    admin = location.get("admin1")
    country = location.get("country")

    if admin and admin not in parts:
        parts.append(admin)
    if country and country not in parts:
        parts.append(country)
    return ", ".join(part for part in parts if part)


def _wind_compass(degrees):
    if degrees is None:
        return "Variable"

    directions = (
        "N",
        "NNE",
        "NE",
        "ENE",
        "E",
        "ESE",
        "SE",
        "SSE",
        "S",
        "SSW",
        "SW",
        "WSW",
        "W",
        "WNW",
        "NW",
        "NNW",
    )
    index = int((float(degrees) + 11.25) / 22.5) % len(directions)
    return directions[index]


def _recommendation(temp_max, precipitation, wind_speed, condition):
    notes = []

    if temp_max is not None:
        if temp_max >= 32:
            notes.append("Wear breathable clothes and keep water nearby.")
        elif temp_max >= 24:
            notes.append("Light layers should feel comfortable.")
        elif temp_max >= 16:
            notes.append("A light jacket is a good backup.")
        elif temp_max >= 8:
            notes.append("Dress warm and keep a jacket close.")
        else:
            notes.append("Bundle up with a warm outer layer.")

    if precipitation is not None and precipitation >= 5:
        notes.append("Carry an umbrella or rain jacket.")
    elif precipitation is not None and precipitation > 0:
        notes.append("A compact umbrella would be smart.")

    if wind_speed is not None and wind_speed >= 35:
        notes.append("Expect strong wind, so avoid loose accessories.")

    if "Thunderstorm" in condition:
        notes.append("Plan around possible storm delays.")

    return " ".join(notes) or "Comfortable everyday clothes should work."
