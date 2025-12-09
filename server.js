import express from 'express'
import linebot from 'linebot'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

/* ====================
   基本設定
==================== */

const app = express()
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => {
  res.status(200).send('OK')
})

/* ====================
   LINE Bot 設定
==================== */

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
})

// ✅ 只用 parser，不自己回 res
app.post('/webhook', bot.parser())

/* ====================
   台北垃圾車資料
==================== */

const DATASET_ID = 'a6e90031-7ec4-4089-afb5-361a4efe7202'
const BASE_URL = `https://data.taipei/api/v1/dataset/${DATASET_ID}?scope=resourceAquire`

let CACHED_POINTS = []

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
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2
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

  return results.filter(r => r['緯度'] && r['經度'])
}

// ✅ 啟動時載入一次
async function initData() {
  CACHED_POINTS = await fetchAllTrashPoints()
  console.log(`✅ 已載入垃圾車資料：${CACHED_POINTS.length} 筆`)
}
initData()

/* ====================
   Flex 卡片
==================== */

function makeFlexBubbles(rows) {
  return rows.map(r => {
    const arrive = hhmmToClock(r['抵達時間'])
    const leave = hhmmToClock(r['離開時間'])
    const mapUrl = toMapUrl(r['緯度'], r['經度'], r['地點'])

    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
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
            text: `🛻 ${r['路線']}（${r['車次']}）`,
            size: 'sm'
          },
          {
            type: 'text',
            text: `⏰ ${arrive} - ${leave}`,
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
              uri: mapUrl
            }
          }
        ]
      }
    }
  })
}

/* ====================
   事件處理（重點）
==================== */

bot.on('message', async event => {
  try {
    console.log('收到訊息類型：', event.message.type)

    // ✅ 只有在「定位」才正式回垃圾車
    if (event.message.type === 'location') {
      const { latitude, longitude } = event.message

      const nearest = CACHED_POINTS
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

      const bubbles = makeFlexBubbles(nearest)

      await event.reply({
        type: 'flex',
        altText: '最近的垃圾車地點',
        contents: {
          type: 'carousel',
          contents: bubbles
        }
      })
      return
    }

    // ✅ 文字只做提示，不「吃掉」定位流程
    if (event.message.type === 'text') {
      if (event.message.text.includes('垃圾')) {
        await event.reply(
          '🚛 請用 LINE 的「＋ → 位置資訊」傳送定位，我會幫你查最近的垃圾車'
        )
      }
      return
    }

  } catch (err) {
    console.error('❌ 錯誤：', err)
    try {
      await event.reply('系統錯誤，請稍後再試')
    } catch {}
  }
})

/* ====================
   啟動
==================== */

app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`)
})
