from flask import Flask, jsonify, render_template, request

from weather_utils import WeatherLookupError, get_weather, search_cities

app = Flask(__name__)


@app.after_request
def add_development_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/get_forecast', methods=['GET', 'POST', 'OPTIONS'])
def get_forecast():
    if request.method == 'OPTIONS':
        return ('', 204)

    data = request.args if request.method == 'GET' else (request.get_json(silent=True) or {})
    city = (data.get('city') or '').strip()
    date_value = (data.get('date') or '').strip()
    location = data.get('location') if isinstance(data, dict) else None

    try:
        forecast = get_weather(city, date_value, location)
    except WeatherLookupError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("Forecast lookup failed")
        return jsonify({"error": f"Server error while fetching weather: {exc}"}), 500

    return jsonify(forecast)


@app.route('/search_cities')
def city_suggestions():
    query = (request.args.get('q') or '').strip()

    try:
        return jsonify({"cities": search_cities(query)})
    except WeatherLookupError as exc:
        return jsonify({"cities": [], "error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("City search failed")
        return jsonify({"cities": [], "error": f"Server error while searching cities: {exc}"}), 500


if __name__ == '__main__':
    app.run(debug=True)
