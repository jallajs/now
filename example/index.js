var choo = require('choo')
var html = require('choo/html')
var app = choo()

app.route('/', function (state) {
  return html`
    <body>
      Hello ${state.query.name || 'planet'}!
    </body>
  `
})

module.exports = app.mount('body')
