const Composer = require('telegraf/composer')

const {
  getWebpBuffer,
} = require('../functions/core')

const composer = new Composer()

composer.on('inline_query', async (ctx) => {
  const text = ctx.inlineQuery.query
  if (text.length === 0) {
    return
  }
  ctx.log.info(`inline: ${text}`)

  /*const webpBuffer = await getWebpBuffer(
    text,
    {
      color: 'red',
      buttons_show: {
        ok: false,
        cancel: false,
      },
      showShadow: false,
    }
  )

  const webpBufferOk = await getWebpBuffer(
    text,
    {
      color: 'red',
      buttons_show: {
        ok: true,
        cancel: false,
      },
      showShadow: false,
    }
  )

  const webpBufferOkCancel = await getWebpBuffer(
    text,
    {
      color: 'red',
      buttons_show: {
        ok: true,
        cancel: true,
      },
      showShadow: false,
    }
  )

  const message = await ctx.telegram.sendDocument(
    -1001265339159,
    {source: webpBuffer, filename: 'sticker.webp'}
  )

  const messageOk = await ctx.telegram.sendDocument(
    -1001265339159,
    {source: webpBufferOk, filename: 'sticker.webp'}
  )

  const messageOkCancel = await ctx.telegram.sendDocument(
    -1001265339159,
    {source: webpBufferOkCancel, filename: 'sticker.webp'}
  )

  // const jpeg = await pngToJpeg({quality: 90})(sourcePng)
  // const result = await uploadByBuffer(jpeg)
  // const url = result.link
  // console.log(url)

  const fileId = message.sticker.file_id
  const fileIdOk = messageOk.sticker.file_id
  const fileIdOkCancel = messageOkCancel.sticker.file_id*/

  return ctx.answerInlineQuery([
    {
      type: 'photo',
      id: text,

      photo_url: `https://homm3.loskir.ru?text=${text}&show_ok=false`,
      thumb_url: `https://homm3.loskir.ru?text=${text}&show_ok=false`,
    },
    {
      type: 'photo',
      id: `${text}_ok`,

      photo_url: `https://homm3.loskir.ru?text=${text}`,
      thumb_url: `https://homm3.loskir.ru?text=${text}`,
    },
    {
      type: 'photo',
      id: `${text}_ok_cancel`,

      photo_url: `https://homm3.loskir.ru?text=${text}&show_cancel=true`,
      thumb_url: `https://homm3.loskir.ru?text=${text}&show_cancel=true`,
    },
  ])
})

composer.on('chosen_inline_result', ({chosenInlineResult}) => {
  console.log('chosen inline result', chosenInlineResult)
})

module.exports = composer
