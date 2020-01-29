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

  const webpBuffer = await getWebpBuffer(
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
  return ctx.answerInlineQuery([
    {
      type: 'sticker',
      id: `${text}`,
      sticker_file_id: message.sticker.file_id,
    },
    {
      type: 'sticker',
      id: `${text}:ok`,
      sticker_file_id: messageOk.sticker.file_id,
    },
    {
      type: 'sticker',
      id: `${text}:ok:cancel`,
      sticker_file_id: messageOkCancel.sticker.file_id,
    },
  ])
})

composer.on('chosen_inline_result', ({chosenInlineResult}) => {
  console.log('chosen inline result', chosenInlineResult)
})

module.exports = composer
