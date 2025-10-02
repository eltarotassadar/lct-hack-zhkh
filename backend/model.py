import pandas as pd
from catboost import CatBoostRegressor

catboost_model = CatBoostRegressor(embedding_features=['embeddings']).load_model('./weights/weights.cbm')

embedding_df = pd.read_json('./weights/embeddings.json')
columns = [
    'year',
    'embeddings',
    'avg_day_temp_prorastanie',
    'min_day_temp_prorastanie',
    'max_day_temp_prorastanie',
    'avg_soil_moisture_100_to_255cm_prorastanie',
    'sum_rain_prorastanie',
    'avg_temperature_soil_prorastanie',
    'avg_cloud_cover_high_prorastanie',
    'gtd_prorastanie',
    'avg_day_temp_vshody',
    'min_day_temp_vshody',
    'max_day_temp_vshody',
    'avg_soil_moisture_100_to_255cm_vshody',
    'sum_rain_vshody',
    'avg_temperature_soil_vshody',
    'avg_cloud_cover_high_vshody',
    'gtd_vshody',
    'avg_day_temp_veg_faza',
    'min_day_temp_veg_faza',
    'max_day_temp_veg_faza',
    'avg_soil_moisture_100_to_255cm_veg_faza',
    'sum_rain_veg_faza',
    'avg_temperature_soil_veg_faza',
    'avg_cloud_cover_high_veg_faza',
    'gtd_veg_faza',
    'avg_day_temp_cvetenie',
    'min_day_temp_cvetenie',
    'max_day_temp_cvetenie',
    'avg_soil_moisture_100_to_255cm_cvetenie',
    'sum_rain_cvetenie',
    'avg_temperature_soil_cvetenie',
    'avg_cloud_cover_high_cvetenie',
    'gtd_cvetenie',
    'avg_day_temp_form_bobov',
    'min_day_temp_form_bobov',
    'max_day_temp_form_bobov',
    'avg_soil_moisture_100_to_255cm_form_bobov',
    'sum_rain_form_bobov',
    'avg_temperature_soil_form_bobov',
    'avg_cloud_cover_high_form_bobov',
    'gtd_form_bobov',
    'avg_day_temp_sozrevanie',
    'min_day_temp_sozrevanie',
    'max_day_temp_sozrevanie',
    'avg_soil_moisture_100_to_255cm_sozrevanie',
    'sum_rain_sozrevanie',
    'avg_temperature_soil_sozrevanie',
    'avg_cloud_cover_high_sozrevanie',
    'gtd_sozrevanie',
    'avg_day_temp_ubor_urozhaya',
    'min_day_temp_ubor_urozhaya',
    'max_day_temp_ubor_urozhaya',
    'avg_soil_moisture_100_to_255cm_ubor_urozhaya',
    'sum_rain_ubor_urozhaya',
    'avg_temperature_soil_ubor_urozhaya',
    'avg_cloud_cover_high_ubor_urozhaya',
    'gtd_ubor_urozhaya'
]

async def predict(year, weather: pd.DataFrame):
    data = embedding_df.copy()

    data['year'] = year

    data = data.merge(weather, on='year', how='left')
    data = data.drop(['sample'], axis=1)
    data = data[columns]

    predicted_data = catboost_model.predict(data)

    response = []
    for index in range(len(data)):
        response.append({
            'sample': embedding_df.at[index, 'sample'],
            'yield': predicted_data[index]
        })

    return sorted(response, key=lambda v: v['yield'], reverse=True)