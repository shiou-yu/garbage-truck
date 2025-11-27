import express from 'express'
import linebot from 'linebot'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const app = express()

app.get('/', (req, res) => {
  res.status(200).send('OK')
})

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
})

const linebotParser = bot.parser()

app.post('/webhook', linebotParser, (req, res) => {
  res.sendStatus(200)
})

const DATASET_ID = 'a6e90031-7ec4-4089-afb5-361a4efe7202'
const BASE_URL = `https://data.taipei/api/v1/dataset/${DATASET_ID}?scope=resourceAquire`

function hhmmToClock(hhmm) {
  if (!hhmm) return ''
  const s = String(hhmm).padStart(4, '0')
  return `${s.slice(0, 2)}:${s.slice(2)}`
}

function toMapUrl(lat, lng, name = '') {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${lat},${lng} ${name}`
  )}`
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

async function fetchAllTrashPoints() {
  const results = []
  const pageSize = 500

  for (let offset = 0; offset < 5000; offset += pageSize) {
    const url = `${BASE_URL}&limit=${pageSize}&offset=${offset}`
    const r = await axios.get(url)
    const payload = r.data?.result
    const rows = payload?.results || []

    if (!rows.length) break
    results.push(...rows)

    const total = payload?.count ?? 0
    if (offset + rows.length >= total) break
  }
  return results
}

function makeFlexBubbles(rows) {
  return rows.map((r) => {
    const arrive = hhmmToClock(r['抵達時間'])
    const leave = hhmmToClock(r['離開時間'])
    const mapUrl = toMapUrl(r['緯度'], r['經度'], r['地點'])

    return {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: r["地點"],
            weight: "bold",
            wrap: true,
            size: "lg"
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "行政區", size: "sm", color: "#888" },
                  { type: "text", text: r["行政區"], size: "sm", align: "end" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "里別", size: "sm", color: "#888" },
                  { type: "text", text: r["里別"], size: "sm", align: "end" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "路線", size: "sm", color: "#888" },
                  { type: "text", text: `${r["路線"]}（${r["車次"]}）`, size: "sm", align: "end" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "時間", size: "sm", color: "#888" },
                  { type: "text", text: `${arrive} - ${leave}`, size: "sm", align: "end" }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1A73E8",
            action: { type: "uri", label: "📍 開啟地圖", uri: mapUrl }
          }
        ]
      }
    }
  })
}

bot.on('message', async (event) => {
  try {
    if (event.message.type !== 'location') {
      await event.reply('請傳送您的定位，我會查最近的垃圾車地點 📍')
      return
    }

    const { latitude, longitude } = event.message
    const all = await fetchAllTrashPoints()

    const withDistance = all.map((r) => {
      const lat = parseFloat(r['緯度'])
      const lng = parseFloat(r['經度'])
      return { ...r, distance: haversine(latitude, longitude, lat, lng) }
    })

    withDistance.sort((a, b) => a.distance - b.distance)
    const nearest = withDistance.slice(0, 3)

    const bubbles = makeFlexBubbles(nearest)

    const flex = {
      type: "flex",
      altText: "最近的垃圾車點",
      contents: {
        type: "carousel",
        contents: bubbles
      }
    }

    await event.reply(flex)

  } catch (err) {
    try { await event.reply("發生錯誤，請稍後再試") } catch {}
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => console.log(` Bot running on port ${PORT}`))
