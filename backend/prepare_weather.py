import pandas as pd

SEASONS = {
    'prorastanie': ('05-01', '05-14'),
    'vshody': ('05-15', '05-28'),
    'veg_faza': ('05-29', '06-11'),
    'cvetenie': ('06-12', '06-25'),
    'form_bobov': ('06-26', '07-09'),
    'sozrevanie': ('07-10', '07-23'),
    'ubor_urozhaya': ('07-24', '09-20')
}

async def prepare_weather(raw_weather):
    time_index = pd.to_datetime(raw_weather['hourly']['time'])

    variables = [
        'temperature_2m', 'rain', 'cloud_cover_high',
        'soil_temperature_100_to_255cm', 'soil_moisture_100_to_255cm'
    ]

    meteo_data = {'date': time_index}

    for var in variables:
        meteo_data[var] = raw_weather['hourly'].get(var, [])


    meteo = pd.DataFrame(meteo_data)

    result = pd.DataFrame()

    for year in meteo['date'].dt.year.unique():
        year_data = meteo[meteo['date'].dt.year == year]
        year_stats = {}
        year_stats['year'] = year

        for season_name, (start, end) in SEASONS.items():
            start_date = pd.to_datetime(f"{year}-{start}").tz_localize(None)
            end_date = pd.to_datetime(f"{year}-{end}").tz_localize(None)

            season_data = year_data[(year_data['date'] >= start_date) & (year_data['date'] <= end_date)]

            if season_data.empty:
                continue

            year_stats[f'avg_day_temp_{season_name}'] = season_data['temperature_2m'].mean()
            year_stats[f'min_day_temp_{season_name}'] = season_data['temperature_2m'].min()
            year_stats[f'max_day_temp_{season_name}'] = season_data['temperature_2m'].max()
            year_stats[f'avg_soil_moisture_100_to_255cm_{season_name}'] = season_data['soil_moisture_100_to_255cm'].mean()
            year_stats[f'sum_rain_{season_name}'] = season_data['rain'].sum()
            year_stats[f'avg_temperature_soil_{season_name}'] = season_data['soil_temperature_100_to_255cm'].mean()
            year_stats[f'avg_cloud_cover_high_{season_name}'] = season_data['cloud_cover_high'].mean()

            sum_of_temperatures_above_10 = season_data.query("temperature_2m > 10")["temperature_2m"].sum()
            total_precipitation = season_data['rain'].sum()
            gtd = total_precipitation / (0.1 * sum_of_temperatures_above_10)
            year_stats[f'gtd_{season_name}'] = gtd

        result = pd.concat([result, pd.DataFrame([year_stats])], ignore_index=True)

    return result

async def aggregate_weather(raw_weather):
    time_index = pd.to_datetime(raw_weather['hourly']['time'])

    variables = [
        'temperature_2m', 'rain', 'cloud_cover_high', 'relative_humidity_2m',
        'soil_temperature_100_to_255cm', 'soil_moisture_100_to_255cm'
    ]

    meteo_data = {'date': time_index}

    for var in variables:
        meteo_data[var] = raw_weather['hourly'].get(var, [])

    meteo = pd.DataFrame(meteo_data)

    result = {}

    result['temperature_2m'] = meteo.groupby(meteo['date'].dt.date)['temperature_2m'].mean().to_list()
    result['relative_humidity_2m'] = meteo.groupby(meteo['date'].dt.date)['relative_humidity_2m'].mean().to_list()
    result['rain'] = meteo.groupby(meteo['date'].dt.date)['rain'].sum().to_list()
    result['cloud_cover_high'] = meteo.groupby(meteo['date'].dt.date)['cloud_cover_high'].mean().to_list()
    result['soil_temperature_100_to_255cm'] = meteo.groupby(meteo['date'].dt.date)['soil_temperature_100_to_255cm'].mean().to_list()
    result['soil_moisture_100_to_255cm'] = meteo.groupby(meteo['date'].dt.date)['soil_moisture_100_to_255cm'].mean().to_list()
    result['time'] = meteo.groupby(meteo['date'].dt.date)['date'].first().to_list()


    return result
