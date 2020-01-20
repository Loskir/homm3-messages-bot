const chunk = require('chunk')

const {Markup} = require('telegraf')

const {getLanguages} = require('../functions/languages')

module.exports = (ctx) => {
  let languages = getLanguages(ctx)
    .map(lang => Markup.callbackButton(ctx.i18n.repository[lang].language_name(), `select_lang_${lang}`))
  return chunk(languages, 2)
}
