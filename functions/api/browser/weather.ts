export const onRequestPost: PagesFunction = async ({ request }) => {
  const { city } = await request.json() as { city?: string }
  const location = (city || '').trim()
  if (!location) {
    return Response.json({ error: 'Paramètre city requis' }, { status: 400 })
  }

  try {
    let latitude: number
    let longitude: number
    let cityName: string

    // Accept "latitude,longitude" (e.g. from GPS) directly — no geocoding needed
    const coordsMatch = location.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
    if (coordsMatch) {
      latitude = Number(coordsMatch[1])
      longitude = Number(coordsMatch[2])
      cityName = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
    } else {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr`
      )
      const geoData = await geoRes.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> }

      if (!geoData.results || geoData.results.length === 0) {
        return Response.json({ error: `Ville "${location}" non trouvée` }, { status: 404 })
      }

      latitude = geoData.results[0].latitude
      longitude = geoData.results[0].longitude
      cityName = geoData.results[0].name
    }

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&current=temperature_2m,weathercode,windspeed_10m&timezone=Europe/Paris&forecast_days=5`
    )
    const weather = await weatherRes.json() as Record<string, unknown>

    const weatherCodes: Record<number, string> = {
      0: 'Ciel dégagé ☀️', 1: 'Peu nuageux 🌤️', 2: 'Partiellement nuageux ⛅', 3: 'Couvert ☁️',
      45: 'Brouillard 🌫️', 48: 'Brouillard givrant 🌫️',
      51: 'Bruine légère 🌦️', 53: 'Bruine 🌦️', 55: 'Bruine forte 🌧️',
      61: 'Pluie légère 🌧️', 63: 'Pluie 🌧️', 65: 'Pluie forte 🌧️',
      71: 'Neige légère ❄️', 73: 'Neige ❄️', 75: 'Neige forte ❄️',
      80: 'Averses 🌦️', 81: 'Averses 🌧️', 82: 'Fortes averses ⛈️',
      95: 'Orage ⛈️', 96: 'Orage grêle ⛈️', 99: 'Orage grêle fort ⛈️',
    }

    const current_data = weather.current as Record<string, number>
    const daily = weather.daily as Record<string, number[] | string[]>

    const current = {
      temperature: current_data?.temperature_2m,
      wind: current_data?.windspeed_10m,
      condition: weatherCodes[current_data?.weathercode] || 'Inconnu',
    }

    const forecast = (daily?.time as string[])?.map((date: string, i: number) => ({
      date,
      min: (daily.temperature_2m_min as number[])[i],
      max: (daily.temperature_2m_max as number[])[i],
      rain_chance: (daily.precipitation_probability_max as number[])[i],
      condition: weatherCodes[(daily.weathercode as number[])[i]] || 'Inconnu',
    })) || []

    return Response.json({ city: cityName, current, forecast })
  } catch {
    return Response.json({ error: 'Erreur météo' }, { status: 500 })
  }
}
