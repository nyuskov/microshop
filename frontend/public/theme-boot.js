// Применяем сохранённую тему до первого кадра, чтобы не мигала светлая.
;(function () {
  try {
    var root = document.documentElement
    var stored = JSON.parse(localStorage.getItem('appearance') || '{}')
    var mode = stored.mode || null
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
      var legacy = localStorage.getItem('app-theme')
      if (legacy === 'light' || legacy === 'dark') mode = legacy
    }
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'dark'
    var dark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    // Чёрный фон (AMOLED, хранится флагом `amoled`) — уточнение тёмной темы:
    // в светлой схеме флаг ничего не меняет (как и в store).
    var theme = dark && stored.amoled ? 'amoled' : dark ? 'dark' : 'light'
    root.setAttribute('data-theme', theme)
    var accents = {
      green: '#2ea25e',
      blue: '#2f7fd1',
      cyan: '#14a09c',
      violet: '#7c5cd6',
      pink: '#d6579a',
      orange: '#ee7f1d',
      red: '#e04545',
      indigo: '#5a6ee8'
    }
    root.style.setProperty('--ms-accent', accents[stored.accentKey] || '#2ea25e')
    if (stored.bubbleKey) root.setAttribute('data-bubble', stored.bubbleKey)
    // Повышенная контрастность — флаг (не тема): либо из настроек, либо из
    // системного переключателя при первом запуске (как в stores/theme.ts).
    var prefersContrast = window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches
    root.setAttribute(
      'data-contrast',
      stored.highContrast === undefined
        ? prefersContrast
          ? 'high'
          : 'normal'
        : stored.highContrast
          ? 'high'
          : 'normal'
    )
    var themeColor = document.querySelector('meta[name="theme-color"]')
    if (themeColor)
      themeColor.setAttribute(
        'content',
        theme === 'amoled'
          ? '#000000'
          : theme === 'dark'
            ? '#10151c'
            : accents[stored.accentKey] || '#2ea25e'
      )
  } catch (e) {
    /* невалидный localStorage — пропускаем */
  }
  // Страница уходила из звонка (закрытие приложения или перезагрузка) — см.
  // rememberCallLeave в stores/call/session.ts.
  //
  // Для сервера перезагрузка выглядит точно так же, как закрытие: он ждёт
  // несколько секунд и завершает звонок у собеседников, если человек не вернулся.
  // Поэтому отменяем уход ПЕРВЫМ же запросом, не дожидаясь загрузки приложения:
  // на слабом телефоне бандл идёт секунды, и сервер успел бы завершить звонок
  // раньше, чем приложение сказало бы «я здесь».
  try {
    var leaving = sessionStorage.getItem('pismo_call_leaving')
    if (leaving) {
      sessionStorage.removeItem('pismo_call_leaving')
      try {
        var leave = JSON.parse(leaving) || {}
        var auth = JSON.parse(localStorage.getItem('authState') || '{}')
        var token = auth && auth.accessToken
        if (leave.cancelUrl && token) {
          fetch(leave.cancelUrl, {
            method: 'POST',
            keepalive: true,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({ call_id: leave.callId || '' })
          }).catch(function () {})
        }
      } catch (inner) {
        /* запись повреждена — уход отменит подключение сигнального канала */
      }
    }
  } catch (e2) {
    /* приватный режим — sessionStorage недоступен */
  }
})()
