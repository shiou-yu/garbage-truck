import express from 'express'
import linebot from 'linebot'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => res.send('OK'))

const bot = linebot({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
})

app.post('/webhook', bot.parser())

const IMAGE_URL =
  'https://raw.githubusercontent.com/shiou-yu/garbage-truck/main/img/2107.i126.021.F.m005.c9.garbage.jpg'

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
}

loadTrashData()

const HOME_FLEX = {
  type: 'bubble',
  hero: {
    type: 'image',
    url: IMAGE_URL,
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover'
  },
  body: {
    type: 'box',
    layout: 'vertical',
    spacing: 'md',
    contents: [
      { type: 'text', text: '垃圾車查詢', weight: 'bold', size: 'xl' },
      {
        type: 'text',
        text: '請傳送定位以查詢離你最近的垃圾車',
        wrap: true,
        size: 'sm',
        color: '#555555'
      }
    ]
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    contents: [
      {
        type: 'button',
        style: 'primary',
        action: { type: 'location', label: '傳送定位' }
      }
    ]
  }
}

function makeResultFlex(place, time, distance) {
  return {
    type: 'bubble',
    hero: HOME_FLEX.hero,
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: '最近的垃圾車', weight: 'bold', size: 'lg' },
        { type: 'text', text: `地點：${place}`, wrap: true, size: 'sm' },
        { type: 'text', text: `時間：${time}`, size: 'sm' },
        { type: 'text', text: `距離：約 ${distance} 公尺`, size: 'sm' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: { type: 'location', label: '再查一次' }
        }
      ]
    }
  }
}

bot.on('message', async event => {
  const msg = event.message

  if (msg.type === 'location') {
    const { latitude, longitude } = msg

    let nearest = null
    let minDistance = Infinity

    for (const r of TRASH_POINTS) {
      const lat = Number(r['緯度'])
      const lng = Number(r['經度'])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      const d = haversine(latitude, longitude, lat, lng)
      if (d < minDistance) {
        minDistance = d
        nearest = r
      }
    }

    if (!nearest) {
      await event.reply('找不到附近的垃圾車資料')
      return
    }

    const arrive = nearest['抵達時間']?.toString().padStart(4, '0')
    const leave = nearest['離開時間']?.toString().padStart(4, '0')
    const timeText =
      arrive && leave
        ? `${arrive.slice(0,2)}:${arrive.slice(2)} - ${leave.slice(0,2)}:${leave.slice(2)}`
        : '時間未提供'

    await event.reply({
      type: 'flex',
      altText: '最近的垃圾車',
      contents: makeResultFlex(
        nearest['地點'] || '未知',
        timeText,
        Math.round(minDistance * 1000)
      )
    })
    return
  }

  await event.reply({
    type: 'flex',
    altText: '垃圾車查詢',
    contents: HOME_FLEX
  })
})

app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`)
})
