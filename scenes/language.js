const Scene = require('telegraf/scenes/base')

const {Extra, Markup} = require('telegraf')

const utils = require('../core/utils')

const languageKeyboard = require('../keyboards/language')

const scene = new Scene('language')
scene.enter((ctx) => {
  ctx.log.info('view list languages')
  return ctx[utils.methodDecider(ctx)](
    ctx.i18n.t('settings.choose_language'),
    Extra
      .HTML()
      .markup(Markup.inlineKeyboard(languageKeyboard(ctx))),
  )
})
scene.action(/select_lang_(.*)/, async (ctx) => {
  const language = ctx.match[1]

  ctx.i18n.locale(language)
  ctx.user.language = language

  ctx.answerCbQuery()

  ctx.log.info(`select language - ${ctx.user.language}`)
  await ctx.user.save()

  return ctx.scene.enter('start')
})

module.exports = scene
