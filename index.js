var utils = require('@now/build-utils')
var browserify = require('browserify')
var concat = require('concat-stream')
var jallaify = require('jallaify')
var dedent = require('dedent')
var jalla = require('jalla')
var path = require('path')
var fs = require('fs')

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production'
}

exports.build = build

async function build ({ files, entrypoint, config, workPath }) {
  console.log('@jallajs/now: downloading user files')
  await utils.download(files, workPath)

  console.log('@jallajs/now: installing dependencies')
  await utils.runNpmInstall(workPath)

  var assets = {}
  var name = files[entrypoint].digest
  var opts = { node: true, standalone: name, basedir: workPath }
  var b = browserify(entrypoint, opts)

  var build = new Promise(function (resolve, reject) {
    b.on('jalla.entry', function (entry) {
      var app = jalla(entry, Object.assign({ quiet: true }, config))
      var dist = path.join(workPath, 'dist')

      app.on('bundle:script', onasset)
      app.on('bundle:style', onasset)
      app.on('bundle:asset', onasset)
      app.on('register:asset', onasset)

      console.log('@jallajs/now: building assets')
      app.build(dist, function (err) {
        if (err) return reject(err)
        fs.readFile(path.join(dist, '.map.json'), function (err, buf) {
          if (err) return reject(err)
          var map = path.join('dist', '.map.json')
          assets[map] = new utils.FileBlob({ data: buf })
          resolve()
        })
      })

      function onasset (file, uri, buf) {
        var asset = app.context.assets[uri]
        var out = path.join('dist', asset.url)
        assets[out] = new utils.FileBlob({ data: buf })
      }
    })
  })

  var bundle = new Promise(function (resolve, reject) {
    console.log('@jallajs/now: bundling server')
    b.on('error', reject)
    b.plugin(jallaify, config)
    b.bundle().pipe(concat(resolve))
  })

  await Promise.all([build, bundle])

  console.log('@jallajs/now: creating lambda')
  var lambda = await utils.createLambda({
    files: Object.assign({
      'launcher.js': new utils.FileBlob({ data: launcher('server.js') }),
      'bridge.js': new utils.FileFsRef({ fsPath: require('@now/node-bridge') }),
      'server.js': new utils.FileBlob({ data: await bundle })
    }, assets),
    handler: 'launcher.launcher',
    runtime: 'nodejs8.10'
  })

  console.log('@jallajs/now: done')

  return { [entrypoint]: lambda }
}

function launcher (entry) {
  return dedent`
    var http = require('http')
    var Bridge = require('./bridge')

    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'production'
    }

    try {
      var listener = require('./${entry}')
      if (listener.default) listener = listener.default
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        console.error(err.message)
        console.error('Did you forget to add it to "dependencies" in package.json?')
        process.exit(1)
      } else {
        throw err
      }
    }

    const server = new http.Server(listener)
    const bridge = new Bridge(server)
    bridge.listen()

    exports.launcher = bridge.launcher
  `
}
