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
   LINE Bot
===================== */

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
})

// ✅ webhook（只用 parser）
app.post('/webhook', bot.parser())

/* =====================
   台北垃圾車資料
===================== */

const DATASET_ID = 'a6e90031-7ec4-4089-afb5-361a4efe7202'
const BASE_URL = `https://data.taipei/api/v1/dataset/${DATASET_ID}?scope=resourceAquire`

let TRASH_POINTS = []

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = d => d * Math.PI / 180
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
  const result = []
  const limit = 500

  for (let offset = 0; offset < 5000; offset += limit) {
    const r = await axios.get(`${BASE_URL}&limit=${limit}&offset=${offset}`)
    const rows = r.data?.result?.results || []
    if (!rows.length) break
    result.push(...rows)
    if (offset + rows.length >= r.data.result.count) break
  }

  TRASH_POINTS = result.filter(r => r['緯度'] && r['經度'])
  console.log(`✅ 已載入垃圾車資料：${TRASH_POINTS.length} 筆`)
}

loadTrashData()

/* =====================
   Flex 組裝
===================== */

function hhmmToClock(hhmm) {
  if (!hhmm) return ''
  const s = String(hhmm).padStart(4, '0')
  return `${s.slice(0, 2)}:${s.slice(2)}`
}

function makeBubbles(rows) {
  return rows.map(r => ({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: r['地點'],
          weight: 'bold',
          size: 'lg',
          wrap: true
        },
        {
          type: 'text',
          text: `📍 ${r['行政區']}`,
          size: 'sm',
          color: '#555'
        },
        {
          type: 'text',
          text: `⏰ ${hhmmToClock(r['抵達時間'])} - ${hhmmToClock(r['離開時間'])}`,
          size: 'sm'
        },
        {
          type: 'text',
          text: `📏 約 ${Math.round(r.distance * 1000)} 公尺`,
          size: 'sm',
          color: '#1A73E8'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: {
            type: 'uri',
            label: '開啟地圖',
            uri: `https://www.google.com/maps/search/?query=${r['緯度']},${r['經度']}`
          }
        }
      ]
    }
  }))
}

/* =====================
   Message Handler（核心）
===================== */

bot.on('message', async event => {
  console.log('收到訊息類型：', event.message.type)

  /* ✅ 只處理定位 */
  if (event.message.type === 'location') {

    const { latitude, longitude } = event.message

    const nearest = TRASH_POINTS
      .map(r => ({
        ...r,
        distance: haversine(
          latitude,
          longitude,
          parseFloat(r['緯度']),
          parseFloat(r['經度'])
        )
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)

    if (!nearest.length) {
      await event.reply('附近沒有垃圾車資料')
      return
    }

    // ✅ 只 reply 一次，而且就是 Flex
    await event.reply({
      type: 'flex',
      altText: '最近的垃圾車地點',
      contents: {
        type: 'carousel',
        contents: makeBubbles(nearest)
      }
    })
    return
  }

  /* ✅ 其他訊息（不影響定位） */
  if (event.message.type === 'text') {
    if (event.message.text.includes('垃圾')) {
      await event.reply('🚛 請用「＋ → 位置資訊」傳送定位')
    }
  }
})

/* =====================
   啟動
===================== */

app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`)
})
