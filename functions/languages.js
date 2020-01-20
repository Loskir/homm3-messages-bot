module.exports = {
  getLanguages(ctx) {
    return Object.keys(ctx.i18n.repository)
      .filter(lang => ctx.i18n.repository[lang].is_enabled)
  }
}
