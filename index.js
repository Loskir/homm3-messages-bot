const Telegraf = require('telegraf')
const I18n = require('telegraf-i18n')
const RedisSession = require('telegraf-session-redis')

const Stage = require('telegraf/stage')

const mongoose = require('mongoose')

const log = require('./core/logs')

const getMe = require('./core/me')

const config = require('./config')

void (async () => {
  await mongoose.connect(config.mongodb, {
    useCreateIndex: true,
    useNewUrlParser: true,
  })

  const bot = new Telegraf(config.bot_token)

  const stage = new Stage()

  const i18n = new I18n({
    defaultLanguage: 'en',
    allowMissing: true,
    useSession: true,
    directory: './locales',
  })
  bot.use(i18n)

  const session = new RedisSession({
    store: {
      ...config.redis,
      retry_strategy(options) {
        if (options.attempt > 10) {
          // End reconnecting with built in error
          throw new Error('Unable to connect to redis')
        }
        log.warn(`Attempt ${options.attempt}, trying to reconnect to redis`)
        return Math.min(options.attempt * 100, 3000)
      }
    },
  })
  bot.use(session)

  bot.use(require('./passThruMiddlewares/log'))

  bot.use(require('./passThruMiddlewares/user'))
  bot.use(require('./passThruMiddlewares/locale'))

  bot.use(require('./passThruMiddlewares/lastActivity'))

  bot.catch((error) => {
    log.error('MTPBOT error: ', error)
    console.error(error.stack)
  })

  stage.use(require('./middlewares/main'))

  stage.use(require('./middlewares/start'))
  stage.use(require('./middlewares/language'))

  stage.register(require('./scenes/start'))
  stage.register(require('./scenes/language'))
  stage.register(require('./scenes/messageCreation'))

  bot.use(stage)

  const me = await getMe()
  bot.options.username = me.username

  bot.startPolling()

  log.info(`@${me.username} is running`)
})()
