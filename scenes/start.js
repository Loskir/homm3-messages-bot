const Scene = require('telegraf/scenes/base')

const {Extra} = require('telegraf')

const utils = require('../core/utils')

const scene = new Scene('start')
scene.enter(utils.answerCbQuery)
scene.enter(async (ctx) => {
  return ctx[utils.methodDecider(ctx)](
    ctx.i18n.t('common.start'),
    Extra.HTML(),
  )
})

module.exports = scene
