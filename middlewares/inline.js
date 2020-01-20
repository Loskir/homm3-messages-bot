const Composer = require('telegraf/composer')
const {uploadByBuffer} = require('telegraph-uploader')
const pngToJpeg = require('png-to-jpeg')
const Jimp = require('jimp')
const sharp = require('sharp')

const composer = new Composer()

const Generator = require('../lib/HommMessageGeneratorNodeBindings')
const generator = new Generator()

composer.on('inline_query', async ({ inlineQuery, answerInlineQuery }) => {
  const text = inlineQuery.query
  console.log(text)

  generator.renderText(text)
  const sourcePng = generator.exportBuffer()

  const webp = sharp(sourcePng)
    .resize(500)
    .toFormat(sharp.format.webp)
    .toBuffer()

  // const jpeg = await pngToJpeg({quality: 90})(sourcePng)
  // const result = await uploadByBuffer(jpeg)
  // const url = result.link
  // console.log(url)
  return answerInlineQuery([
    /*{
      type: 'article',
      id: nanoid(),
      title: '123',
      description: '123',
      input_message_content: {
        message_text: '123'
      },
    },*/
    {
      type: 'photo',
      id: text,

      photo_url: url,
      thumb_url: url,

      title: '123',
      description: '2345',
    }
  ])
})

composer.on('chosen_inline_result', ({ chosenInlineResult }) => {
  console.log('chosen inline result', chosenInlineResult)
})

module.exports = composer
