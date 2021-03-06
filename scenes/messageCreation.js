const Scene = require('telegraf/scenes/base')
const chunk = require('chunk')

const {Extra, Markup} = require('telegraf')

const utils = require('../core/utils')

const {
  getPngBuffer,
  getWebpBuffer,
} = require('../functions/core')

const colors = [
  {text: '♥️', value: 'red'},
  {text: '💙', value: 'blue'},
  {text: '🧡', value: 'orange'},
  {text: '💚', value: 'green'},
  {text: '💛', value: 'brown'},
  {text: '💜', value: 'violet'},
  {text: '🧼', value: 'teal'},
  {text: '🎟', value: 'pink'},
]

const colorSelectedSign = (config, value) => config.color === value ? '✅' : ''

const getConfigKeyboard = (config, colorsKeyboardOpened = false) => {
  if (colorsKeyboardOpened) {
    return Markup.inlineKeyboard(
      chunk(colors.map((color) =>
        Markup.callbackButton(
          colorSelectedSign(config, color.value) + color.text,
          `config_color_${color.value}`
        )
      ), 4)
    )
  }
  return Markup.inlineKeyboard([
    [
      Markup.callbackButton(`As a photo`, `config_as_photo`, config.type === 'photo'),
      Markup.callbackButton(`As a sticker`, `config_as_sticker`, config.type === 'sticker'),
    ],
    [Markup.callbackButton('Change color', `open_colors_keyboard`)],
    [
      Markup.callbackButton(`${config.buttons_show.ok ? '✅' : ''} OK button`, `config_button_ok`),
      Markup.callbackButton(`${config.buttons_show.cancel ? '✅' : ''} Cancel button`, `config_button_cancel`),
    ]
])
}


const getConfig = (stateConfig) => ({
  color: stateConfig.color,
  buttons_show: stateConfig.buttons_show,
  // showShadow: stateConfig.type === 'sticker',
  showShadow: false, // с тенью стикер пережимает, текст хуже читается
})

const scene = new Scene('message-creation')
scene.enter(utils.answerCbQuery)
scene.enter(async (ctx) => {
  ctx.scene.state.config = {
    color: 'red',
    buttons_show: {
      ok: true,
      cancel: false,
    },
    type: 'sticker',
  }

  ctx.scene.state.text = ctx.message.text
  ctx.log.info(ctx.scene.state.text)

  const webp = await getWebpBuffer(ctx.scene.state.text, getConfig(ctx.scene.state.config))

  // const jpeg = await pngToJpeg({quality: 90})(sourcePng)
  // const result = await uploadByBuffer(jpeg)
  // const url = result.link
  // console.log(url)
  // return replyWithPhoto({source: sourcePng})
  return ctx.replyWithDocument(
    {source: webp, filename: 'sticker.webp'},
    Extra.markup(getConfigKeyboard(ctx.scene.state.config, false))
  )
})
scene.action(/config_color_(.+)/, async (ctx) => {
  await ctx.answerCbQuery()
  ctx.scene.state.config.color = ctx.match[1]

  const webp = await getWebpBuffer(ctx.scene.state.text, getConfig(ctx.scene.state.config))

  await ctx.deleteMessage()
  return ctx.replyWithDocument(
    {source: webp, filename: 'sticker.webp'},
    Extra.markup(getConfigKeyboard(ctx.scene.state.config, false))
  )
})
scene.action('open_colors_keyboard', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.editMessageReplyMarkup(
    getConfigKeyboard(ctx.scene.state.config, true),
  )
})
scene.action(/config_button_(.+)/, async (ctx) => {
  await ctx.answerCbQuery()
  ctx.scene.state.config.buttons_show[ctx.match[1]] = !ctx.scene.state.config.buttons_show[ctx.match[1]]

  const webp = await getWebpBuffer(ctx.scene.state.text, getConfig(ctx.scene.state.config))

  await ctx.deleteMessage()
  return ctx.replyWithDocument(
    {source: webp, filename: 'sticker.webp'},
    Extra.markup(getConfigKeyboard(ctx.scene.state.config, false))
  )
})
scene.action('config_as_photo', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.scene.state.config.type = 'photo'

  const png = await getPngBuffer(ctx.scene.state.text, getConfig(ctx.scene.state.config))

  await ctx.deleteMessage()
  return ctx.replyWithPhoto(
    {source: png},
    Extra.markup(getConfigKeyboard(ctx.scene.state.config, false))
  )
})
scene.action('config_as_sticker', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.scene.state.config.type = 'sticker'

  const webp = await getWebpBuffer(ctx.scene.state.text, getConfig(ctx.scene.state.config))

  await ctx.deleteMessage()
  return ctx.replyWithDocument(
    {source: webp, filename: 'sticker.webp'},
    Extra.markup(getConfigKeyboard(ctx.scene.state.config, false))
  )
})

module.exports = scene
