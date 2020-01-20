const Composer = require('telegraf/composer')

const composer = new Composer()

composer.command('lang', ctx => ctx.scene.enter('language'))
composer.action('lang', ctx => ctx.scene.enter('language'))

module.exports = composer
