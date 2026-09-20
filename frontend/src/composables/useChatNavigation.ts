import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { closeTopMobileLayer, mobileLayerDepth } from '@/composables/useMobileOverlay'
import { chatUrlWith } from '@/utils/chatUrl'
import { decideBackStep, type Section } from '@/utils/mobileNav'

/** Слои интерфейса, которые «назад» закрывает по одному (см. decideBackStep). */
export interface NavigationLayers {
  /** Открыт просмотрщик историй. */
  storyId: Ref<number | null>
  /** Открыт лайтбокс (номер кадра). */
  lightboxIndex: Ref<number | null>
  /** Открыт профиль (настройки). */
  profileOpen: Ref<boolean>
  /** Открыт экран информации о чате / группе. */
  chatInfoOpen: Ref<boolean>
  groupInfoOpen: Ref<boolean>
  /** Открыт диалог «Новая группа». */
  createGroupOpen: Ref<boolean>
  /** Активен режим выбора сообщений. */
  messageSelection: Ref<boolean>
}

export interface NavigationHooks {
  /** Профиль открыт на конкретном разделе (а не на списке разделов). */
  profileInSection: () => boolean
  /** Профиль: «назад» выходит из раздела профиля к списку разделов. */
  backToProfileSections: () => void
  /** Выйти из режима выбора сообщений. */
  exitMessageSelection: () => void
  /** Закрыть открытую переписку (сброс нити и адреса). */
  closeOpenChat: () => void
}

export interface ChatNavigationDeps {
  /**
   * Список и нить видны одновременно (десктоп и планшет — от 600px): там
   * история приложения не нужна, «назад» ведёт себя как в браузере.
   */
  twoPane: ComputedRef<boolean>
  /** Открытый раздел списка (Чаты/Контакты). */
  view: Ref<Section>
  /** Открыт ли drawer со списком чатов (значим в мобильном режиме). */
  drawerOpen: Ref<boolean>
  /** Выбранная переписка. */
  selectedChatId: Ref<number | null>
  /** Сайдбар: у него свой режим выделения чатов. */
  chatSelection: () => boolean
  exitChatSelection: () => void
  layers: NavigationLayers
  hooks: NavigationHooks
}

/**
 * Навигация мессенджера: адрес (?chat=), история приложения на мобильном и
 * системная «назад».
 *
 * Каждый «прямой» переход (открытие чата/контактов/модалки/выделения) кладёт
 * маркер в историю; на popstate откатываем экран на один слой. На «корне» (список
 * чатов) системная «назад» выходит из приложения. Логика слоёв — в pure-функции
 * `decideBackStep` (utils/mobileNav.ts), здесь живёт состояние и запись истории.
 */
export function useChatNavigation(deps: ChatNavigationDeps) {
  const router = useRouter()
  const { twoPane, view, drawerOpen, selectedChatId, layers, hooks } = deps

  /**
   * Держим открытый чат в адресной строке (`?chat=<id>`), чтобы перезагрузка
   * страницы — в том числе pull-to-refresh или переоткрытие PWA — возвращала в тот
   * же чат, а не в список.
   *
   * Пишем через историю РОУТЕРА (а не window.history.replaceState): прямая запись
   * затирает служебные поля vue-router (position/back/forward) в записи истории,
   * роутер считает состояние «подменённым» и переписывает адрес. Из-за этого
   * «назад» срабатывал не всегда, а обновление открывало не ту страницу.
   */
  const syncChatUrl = (chatId: number | null) => {
    try {
      const next = chatUrlWith(window.location.href, chatId)
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (next === current) return
      router.options.history.replace(next, {})
    } catch {
      /* история недоступна (например, внутри iframe) — просто не трогаем адрес */
    }
  }

  /** На телефоне: «назад» из открытого чата — снова показать список (drawer). */
  const goBackToList = () => {
    if (!twoPane.value) {
      // Если открытие чата записано в историю — идём «назад» по ней (popstate
      // откроет список), иначе просто показываем список.
      if (window.history.state && window.history.state.pismoNav) {
        window.history.back()
        return
      }
      drawerOpen.value = true
      syncChatUrl(null)
    } else {
      view.value = 'contacts'
    }
  }

  const pushMobileNav = (section?: Section) => {
    if (twoPane.value) return
    try {
      // В записи истории храним раздел, который будет показан на этом шаге:
      // по «назад» возвращаемся именно в него, а не всегда в «Чаты».
      //
      // Пишем через историю РОУТЕРА: window.history.pushState затирает его
      // служебные поля (position/back/forward), и роутер начинает переписывать
      // адрес — история и экран расходятся.
      const url = `${window.location.pathname}${window.location.search}${window.location.hash}`
      router.options.history.push(url, {
        pismoNav: true,
        pismoView: section ?? view.value
      })
    } catch {
      /* история недоступна — игнорируем */
    }
  }

  /** Идёт обработка системного «назад» — программные шаги назад не нужны. */
  let handlingSystemBack = false
  /**
   * Сколько маркеров гасим сами (`history.go(-1)`): обработчик popstate
   * пропускает ровно столько же шагов. Счётчик, а не флаг: когда снимаются
   * сразу два слоя (переключили чат — модалки закрылись разом), уходит два
   * «назад», и первый popstate не должен снимать защиту со второго.
   */
  let programmaticBacks = 0
  /** Страховка от «залипшего» счётчика: popstate может не прийти (гасить нечего). */
  let programmaticReset: number | null = null
  /** Drawer открылся сам (по системному «назад») — маркер уже израсходован. */
  let drawerOpenedByBack = false
  /** Drawer открыли мы сами (переход в раздел) — чужие маркеры не гасим. */
  let drawerOpenedBySection = false

  /** Показать список разделов на телефоне (открыть drawer), не гася историю. */
  const revealDrawer = () => {
    if (twoPane.value || drawerOpen.value) return
    drawerOpenedBySection = true
    drawerOpen.value = true
  }

  /**
   * Гасит маркер истории, поставленный `pushMobileNav()`.
   *
   * Нужен, когда экран закрыли «вручную» (крестик, клик по фону, жест, действие
   * над выбранным): без этого маркер остаётся висеть, и следующее системное
   * «назад» тратится на пустой шаг — человек видит, что «назад не работает».
   * Возвращает true, если маркер был и его убрали.
   */
  const stepBackInApp = (): boolean => {
    if (twoPane.value || handlingSystemBack) return false
    const state = window.history.state as { pismoNav?: boolean } | null
    if (!state?.pismoNav) return false
    programmaticBacks += 1
    if (programmaticReset !== null) window.clearTimeout(programmaticReset)
    // Если popstate почему-то не придёт, защита не должна «съесть» следующее
    // настоящее «назад» — снимаем её по таймауту (popstate приходит за миллисекунды).
    programmaticReset = window.setTimeout(() => {
      programmaticBacks = 0
      programmaticReset = null
    }, 250)
    try {
      router.options.history.go(-1)
    } catch {
      programmaticBacks -= 1
      return false
    }
    return true
  }

  /**
   * Обработка шага назад (системный жест/кнопка или `stepBackInApp`).
   * Закрываем ровно один слой интерфейса — от верхнего к нижнему.
   */
  const handleAppBack = (state: { pismoView?: Section } | null) => {
    const step = decideBackStep({
      overlayLayers: mobileLayerDepth(),
      storyOpen: layers.storyId.value !== null,
      lightboxOpen: layers.lightboxIndex.value !== null,
      profileOpen: layers.profileOpen.value,
      profileInSection: hooks.profileInSection(),
      chatInfoOpen: layers.chatInfoOpen.value,
      groupInfoOpen: layers.groupInfoOpen.value,
      createGroupOpen: layers.createGroupOpen.value,
      messageSelection: layers.messageSelection.value,
      chatSelection: deps.chatSelection(),
      currentView: view.value,
      previousView: state?.pismoView,
      chatOpen: selectedChatId.value !== null,
      drawerOpen: drawerOpen.value,
      twoPane: twoPane.value
    })

    switch (step.kind) {
      case 'overlay':
        // Верхняя модалка закрывает себя сама — стек об этом узнаёт и гасит её
        // шаг в истории (см. watcher `mobileLayerDepth` ниже).
        closeTopMobileLayer()
        return
      case 'story':
        layers.storyId.value = null
        return
      case 'lightbox':
        layers.lightboxIndex.value = null
        return
      case 'profile-section':
        hooks.backToProfileSections()
        return
      case 'overlays':
        layers.profileOpen.value = false
        layers.chatInfoOpen.value = false
        layers.groupInfoOpen.value = false
        layers.createGroupOpen.value = false
        return
      case 'message-selection':
        hooks.exitMessageSelection()
        return
      case 'chat-selection':
        deps.exitChatSelection()
        return
      case 'section':
        view.value = step.section
        // На мобильном раздел живёт в списке (drawer), а не отдельным экраном:
        // если открыта переписка — закрываем её и показываем список раздела
        // (см. `showList` в utils/mobileNav.ts).
        if (step.showList) {
          if (selectedChatId.value !== null) hooks.closeOpenChat()
          revealDrawer()
        }
        return
      case 'list':
        // Открытая нить (drawer скрыт) → список.
        drawerOpenedByBack = true
        drawerOpen.value = true
        // На мобильном список и нить — один экран: показали список, значит и в
        // адресе чата быть не должно.
        syncChatUrl(null)
        return
      case 'exit':
        // Корень — выходим (позволяем браузеру завершить).
        return
    }
  }

  const onAppPopState = (event: PopStateEvent) => {
    // Маркер(ы) погасили сами (экран уже закрыт вручную) — обрабатывать нечего.
    if (programmaticBacks > 0) {
      programmaticBacks -= 1
      if (programmaticBacks === 0 && programmaticReset !== null) {
        window.clearTimeout(programmaticReset)
        programmaticReset = null
      }
      return
    }
    if (twoPane.value) return
    handlingSystemBack = true
    try {
      handleAppBack(event.state as { pismoView?: Section } | null)
    } finally {
      handlingSystemBack = false
    }
  }

  /**
   * Активен ли любой режим выделения (сообщения или чаты): вход в выделение
   * кладёт маркер в историю, выход — гасит.
   *
   * `flush: 'sync'` — чтобы реакция на смену была внутри обработчика «назад»
   * (`handlingSystemBack` тогда ещё true, и лишнего шага не будет).
   */
  const anySelectionActive = computed(() => layers.messageSelection.value || deps.chatSelection())
  watch(
    anySelectionActive,
    (active, wasActive) => {
      if (active === wasActive) return
      if (active) pushMobileNav()
      else if (mobileLayerDepth() === 0) stepBackInApp()
    },
    { flush: 'sync' }
  )

  /**
   * Модалки (общий стек слоёв): на каждый открытый слой — свой шаг в истории.
   *
   * Именно из-за этого «назад» ведёт себя как браузер: открыл три модалки —
   * три раза «назад» закрывают их по одной, и только потом дело доходит до чата,
   * раздела или выхода из приложения. Закрытие модалки ЛЮБЫМ способом (крестик,
   * клик по фону, Esc, выбор действия) слой снимает — и его шаг гасится тут же
   * (`stepBackInApp`), иначе следующее «назад» уйдёт в пустоту.
   */
  let trackedLayerDepth = mobileLayerDepth()
  watch(
    () => mobileLayerDepth(),
    (depth) => {
      const delta = depth - trackedLayerDepth
      trackedLayerDepth = depth
      for (let i = 0; i < Math.abs(delta); i += 1) {
        if (delta > 0) pushMobileNav()
        // Внутри системного «назад» маркер уже израсходован — `stepBackInApp`
        // сам молчит при `handlingSystemBack`.
        else stepBackInApp()
      }
    },
    { flush: 'sync' }
  )

  /**
   * Экран поверх (модалки, просмотрщик истории, лайтбокс) закрыли ЛЮБЫМ способом —
   * крестиком, кликом по фону, жестом. Гасим маркер истории: иначе следующее
   * системное «назад» потратится на пустой шаг («назад не работает»).
   *
   * Если сверху ещё есть модалка из стека, не трогаем маркер: верхний — её, и
   * погасит его она сама.
   */
  const overlayOpen = computed(
    () =>
      layers.profileOpen.value ||
      layers.chatInfoOpen.value ||
      layers.groupInfoOpen.value ||
      layers.createGroupOpen.value ||
      layers.storyId.value !== null ||
      layers.lightboxIndex.value !== null
  )
  watch(
    overlayOpen,
    (open, wasOpen) => {
      if (wasOpen && !open && mobileLayerDepth() === 0) stepBackInApp()
    },
    { flush: 'sync' }
  )

  /**
   * На телефоне список и нить — один экран. Если список открыли жестом (drawer),
   * маркер от нити больше не нужен — гасим его, иначе «назад» уйдёт впустую.
   */
  watch(
    drawerOpen,
    (open) => {
      if (!open || twoPane.value) return
      if (drawerOpenedByBack || drawerOpenedBySection) {
        drawerOpenedByBack = false
        drawerOpenedBySection = false
        return
      }
      stepBackInApp()
    },
    { flush: 'sync' }
  )

  return {
    syncChatUrl,
    goBackToList,
    pushMobileNav,
    revealDrawer,
    stepBackInApp,
    handleAppBack,
    onAppPopState
  }
}
