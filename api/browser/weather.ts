import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { city } = req.body as { city?: string }
  const location = city || 'Valence,FR'

  try {
    // Use Open-Meteo (free, no API key)
    // First geocode the city
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr`
    )
    const geoData = await geoRes.json()

    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: `Ville "${location}" non trouvée` })
    }

    const { latitude, longitude, name: cityName } = geoData.results[0]

    // Get weather
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&current=temperature_2m,weathercode,windspeed_10m&timezone=Europe/Paris&forecast_days=5`
    )
    const weather = await weatherRes.json()

    const weatherCodes: Record<number, string> = {
      0: 'Ciel dégagé ☀️', 1: 'Peu nuageux 🌤️', 2: 'Partiellement nuageux ⛅', 3: 'Couvert ☁️',
      45: 'Brouillard 🌫️', 48: 'Brouillard givrant 🌫️',
      51: 'Bruine légère 🌦️', 53: 'Bruine 🌦️', 55: 'Bruine forte 🌧️',
      61: 'Pluie légère 🌧️', 63: 'Pluie 🌧️', 65: 'Pluie forte 🌧️',
      71: 'Neige légère ❄️', 73: 'Neige ❄️', 75: 'Neige forte ❄️',
      80: 'Averses 🌦️', 81: 'Averses 🌧️', 82: 'Fortes averses ⛈️',
      95: 'Orage ⛈️', 96: 'Orage grêle ⛈️', 99: 'Orage grêle fort ⛈️',
    }

    const current = {
      temperature: weather.current?.temperature_2m,
      wind: weather.current?.windspeed_10m,
      condition: weatherCodes[weather.current?.weathercode] || 'Inconnu',
    }

    const forecast = weather.daily?.time?.map((date: string, i: number) => ({
      date,
      min: weather.daily.temperature_2m_min[i],
      max: weather.daily.temperature_2m_max[i],
      rain_chance: weather.daily.precipitation_probability_max[i],
      condition: weatherCodes[weather.daily.weathercode[i]] || 'Inconnu',
    })) || []

    return res.status(200).json({ city: cityName, current, forecast })
  } catch {
    return res.status(500).json({ error: 'Erreur météo' })
  }
}
