import express from 'express'
import linebot from 'linebot'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => {
  res.status(200).send('OK')
})

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
})

app.post('/webhook', bot.parser())
const DATASET_ID = 'a6e90031-7ec4-4089-afb5-361a4efe7202'
const BASE_URL =
  `https://data.taipei/api/v1/dataset/${DATASET_ID}?scope=resourceAquire`

let TRASH_POINTS = []

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function loadTrashData() {
  try {
    const all = []
    const limit = 500

    for (let offset = 0; offset < 5000; offset += limit) {
      const r = await axios.get(`${BASE_URL}&limit=${limit}&offset=${offset}`)
      const rows = r.data?.result?.results || []
      if (!rows.length) break
      all.push(...rows)
      if (offset + rows.length >= r.data.result.count) break
    }

    TRASH_POINTS = all.filter(r => r['緯度'] && r['經度'])

    console.log(`已載入垃圾車資料：${TRASH_POINTS.length} 筆`)
  } catch (err) {
    console.error('載入垃圾車資料失敗：', err.message)
  }
}

loadTrashData()
bot.on('message', async (event) => {
  console.log('收到訊息類型：', event.message.type)
  if (event.message.type === 'text') {
    await event.reply(
      '垃圾車查詢服務\n\n' +

      '傳送Line的「定位」給我，查詢離你最近的一個垃圾車地點。\n' 
    )
    return
  }
  if (event.message.type === 'location') {
    if (!TRASH_POINTS.length) {
      await event.reply('垃圾車資料尚未載入完成，請稍後再試。')
      return
    }

    const { latitude, longitude } = event.message

    let nearest = null
    let minDistance = Infinity

    for (const r of TRASH_POINTS) {
      const lat = Number(String(r['緯度']).trim())
      const lng = Number(String(r['經度']).trim())

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      const d = haversine(latitude, longitude, lat, lng)

      if (d < minDistance) {
        minDistance = d
        nearest = r
      }
    }

    if (!nearest) {
      await event.reply('附近沒有垃圾車資料。')
      return
    }

    const MAX_DISTANCE_KM = 1 
    if (minDistance > MAX_DISTANCE_KM) {
      await event.reply(
        '此位置附近 1 公里內沒有垃圾車資料。\n' +
        '目前僅支援台北市垃圾車路線，請在台北市範圍內查詢。'
      )
      return
    }
    const arrive = nearest['抵達時間']
      ? nearest['抵達時間'].toString().padStart(4, '0')
      : null
    const leave = nearest['離開時間']
      ? nearest['離開時間'].toString().padStart(4, '0')
      : null

    const timeText =
      arrive && leave
        ? `${arrive.slice(0, 2)}:${arrive.slice(2)} - ${leave.slice(0, 2)}:${leave.slice(2)}`
        : '時間未提供'
    const replyText =
      '最近的垃圾車資訊\n\n' +
      `地點：${nearest['地點'] || '未提供'}\n` +
      `時間：${timeText}\n` +
      `距離：約 ${Math.round(minDistance * 1000)} 公尺`

    await event.reply(replyText)
    return
  }

})

app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`)
})


