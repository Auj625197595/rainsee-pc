//https://www.electron.build/configuration/configuration#afterpack
exports.default = async function(context) {
  //console.log(context)
  const fs = require('fs')
  const path = require('path')
  const localeDir = context.appOutDir + '/locales/'
  const dataDir = path.join(context.appOutDir, 'data')

  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }

  fs.readdir(localeDir, function(err, files) {
    if (!(files && files.length)) return
    for (let i = 0, len = files.length; i < len; i++) {
      const match = files[i].match(/zh-CN|zh-TW|en-US\.pak/)
      if (match === null) {
        fs.unlinkSync(localeDir + files[i])
      }
    }
  })
}
