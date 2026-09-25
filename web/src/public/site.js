// JS del sitio público: pestañas de la demo y los dos formularios (alta y
// login). Sin framework: son tres comportamientos.
(function () {
  'use strict'

  // --- Demo: pestañas ------------------------------------------------------
  var tabs = document.querySelectorAll('[role="tab"]')
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        var on = t === tab
        t.setAttribute('aria-selected', on ? 'true' : 'false')
        var panel = document.getElementById(t.getAttribute('aria-controls'))
        if (panel) panel.hidden = !on
      })
    })
  })

  // --- Formularios ----------------------------------------------------------
  function json(res) {
    return res.text().then(function (t) {
      try { return t ? JSON.parse(t) : {} } catch (e) { return {} }
    })
  }

  function mensaje(status, body, fallback) {
    if (status === 429) return 'Demasiados intentos seguidos. Esperá un rato y probá de nuevo.'
    if (body && body.error && body.error.message) return body.error.message
    return fallback
  }

  // Sólo se vuelve a un lugar de la app: un `next` externo se ignora.
  function destino() {
    var next = new URLSearchParams(window.location.search).get('next') || ''
    return /^\/app(\/|$|\?)/.test(next) ? next : '/app'
  }

  function enviar(form, url, armar, fallback) {
    var err = form.querySelector('.err')
    var btn = form.querySelector('button[type="submit"]')
    form.addEventListener('submit', function (ev) {
      ev.preventDefault()
      err.textContent = ''
      btn.disabled = true
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(armar(new FormData(form))),
      })
        .then(function (res) {
          return json(res).then(function (body) {
            if (res.ok) {
              window.location.assign(destino())
              return
            }
            err.textContent = mensaje(res.status, body, fallback)
            btn.disabled = false
          })
        })
        .catch(function () {
          err.textContent = 'No hay conexión. Probá de nuevo.'
          btn.disabled = false
        })
    })
  }

  var alta = document.getElementById('alta')
  if (alta) {
    enviar(alta, '/api/signup', function (d) {
      return {
        org_name: d.get('org_name'), kind: d.get('kind'), name: d.get('name'),
        email: d.get('email'), password: d.get('password'), website: d.get('website'),
      }
    }, 'No se pudo crear la cuenta.')
  }

  var entrar = document.getElementById('entrar')
  if (entrar) {
    enviar(entrar, '/api/auth/login', function (d) {
      return { email: d.get('email'), password: d.get('password') }
    }, 'Email o contraseña incorrectos.')
  }
})()
