# SkyAI Forecast

A Flask weather app with city autocomplete, daily forecast, air quality summary, clothing advice, and user-selectable themes.

## Features

- City recommendations while typing
- Daily weather for historical dates and near-future forecasts
- Daily max U.S. AQI, average PM2.5, and average PM10
- Theme presets and custom accent color saved in the browser
- No API keys required

## Run Locally

```powershell
py -m pip install -r requirements.txt
py app.py
```

Open:

```text
http://127.0.0.1:5000/
```

## Deploy Publicly On Render

1. Create a public GitHub repository.
2. Upload this project to that repository.
3. In Render, choose **New > Web Service**.
4. Connect the GitHub repository.
5. Use these settings:

```text
Language: Python 3
Build Command: pip install -r requirements.txt
Start Command: gunicorn app:app
```

Render can also read `render.yaml` from this repo.

## Data Sources

- Weather, geocoding, and air quality data are provided by Open-Meteo.
- This app does not store user searches.

## Public Domain

The original project code is dedicated to the public domain under CC0 1.0 Universal. See `LICENSE`.

Only apply CC0 if you own the rights to the work you publish.
