import express from 'express'
import linebot from 'linebot'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

/* =====================
   基本設定
===================== */

const app = express()
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => {
  res.status(200).send('OK')
})

/* =====================
   LINE Bot 設定
===================== */

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
})

// ✅ webhook
app.post('/webhook', bot.parser())

/* =====================
   台北垃圾車資料
===================== */

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

// 只在啟動時載入一次
async function loadTrashData() {
  const all = []
  const limit = 500

  for (let offset = 0; offset < 5000; offset += limit) {
    const r = await axios.get(`${BASE_URL}&limit=${limit}&offset=${offset}`)
    const rows = r.data?.result?.results || []
    if (!rows.length) break
    all.push(...rows)
    if (offset + rows.length >= r.data.result.count) break
  }

  // 只留有經緯度的資料
  TRASH_POINTS = all.filter(r => r['緯度'] && r['經度'])

  console.log(`✅ 已載入垃圾車資料：${TRASH_POINTS.length} 筆`)
}

loadTrashData()

/* =====================
   核心邏輯：定位 → 最近 1 筆
===================== */

bot.on('message', async (event) => {
  console.log('收到訊息類型：', event.message.type)

  // ✅ 只處理「定位」
  if (event.message.type === 'location') {
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
      await event.reply('附近沒有垃圾車資料')
      return
    }

    // 安全處理時間
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

    // ✅ 最終回覆（純文字，最穩）
    const replyText =
      `🚛 最近的垃圾車地點：\n` +
      `${nearest['行政區'] || ''} ${nearest['地點'] || '未知地點'}\n` +
      `⏰ ${timeText}\n` +
      `📏 約 ${Math.round(minDistance * 1000)} 公尺`

    await event.reply(replyText)
    return
  }

  // ❌ 其他訊息一律不回（避免 replyToken 被吃掉）
})

/* =====================
   啟動
===================== */

app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`)
})
