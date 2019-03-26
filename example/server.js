var jalla = require('jalla')
var app = jalla('index.js')
if (process.env.NOW_REGION) module.exports = app.callback()
else app.listen(8080)
