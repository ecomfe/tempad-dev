/* global window, document, location, setTimeout, clearTimeout */
// The JSONP contracts used by Figma's Rspack loader: deduplication, registration and load errors.
;(() => {
  const modules = Object.create(null)
  const installed = Object.create(null)
  const inProgress = Object.create(null)
  const chunks = (window.webpackChunk_figma_web_bundler = [])
  chunks.push = ([ids, factories]) => {
    Object.assign(modules, factories)
    for (const id of ids) {
      const pending = installed[id]
      installed[id] = 0
      if (pending) pending.resolve()
    }
  }
  function loadScript(url, callback, key, insertBefore) {
    if (inProgress[url]) {
      inProgress[url].push(callback)
      return
    }
    let script = Array.from(document.scripts).find(
      (node) => node.getAttribute('src') === url || node.getAttribute('data-webpack') === key
    )
    const attach = !script
    if (!script) {
      script = document.createElement('script')
      script.charset = 'utf-8'
      script.setAttribute('data-webpack', key)
      script.src = url
    }
    inProgress[url] = [callback]
    function complete(event) {
      script.onload = script.onerror = null
      clearTimeout(timer)
      const callbacks = inProgress[url]
      delete inProgress[url]
      script.parentNode?.removeChild(script)
      callbacks?.forEach((done) => done(event))
    }
    const timer = setTimeout(() => complete({ type: 'timeout', target: script }), 3000)
    script.onload = script.onerror = complete
    if (attach) {
      if (insertBefore) document.head.insertBefore(script, document.head.firstChild)
      else document.head.appendChild(script)
    }
  }
  window.loadTestChunk = (id, insertBefore = false) => {
    if (installed[id] === 0) return Promise.resolve(modules[id]())
    if (installed[id]) return installed[id].promise.then(() => modules[id]())
    let resolve, reject
    const promise = new Promise((a, b) => {
      resolve = a
      reject = b
    })
    installed[id] = { promise, resolve, reject }
    const url = `${location.origin}${window.chunkBase}/${id}.min.js`
    loadScript(
      url,
      (event) => {
        if (installed[id] === 0) return
        const pending = installed[id]
        delete installed[id]
        const error = new Error(`Loading chunk ${id} failed (${event.type})`)
        error.name = 'ChunkLoadError'
        pending.reject(error)
      },
      `figma:${id}`,
      insertBefore
    )
    return promise.then(() => modules[id]())
  }
})()
