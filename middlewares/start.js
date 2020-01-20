const Composer = require('telegraf/composer')

const composer = new Composer()
composer.start(ctx => ctx.scene.enter('start'))
composer.action('cancel', ctx => ctx.scene.enter('start'))
composer.command('cancel', ctx => ctx.scene.enter('start'))

composer.command('help', (ctx) => {
  return ctx.replyWithHTML(ctx.i18n.t('common.help'))
})

composer.command('support', (ctx) => {
  return ctx.replyWithHTML(ctx.i18n.t('common.support'))
})

module.exports = composer
