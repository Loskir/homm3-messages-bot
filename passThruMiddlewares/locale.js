module.exports = (ctx, next) => {
  if (ctx.user && ctx.user.language) {
    ctx.i18n.locale(ctx.user.language)
  }
  return next()
}
