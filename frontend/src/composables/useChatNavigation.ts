import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
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
  /** Открыта карточка приглашения в группу (объявляется ниже по файлу — поэтому геттер). */
  inviteOpen: () => boolean
}

export interface NavigationHooks {
  /** Профиль открыт на конкретном разделе (а не на списке разделов). */
  profileInSection: () => boolean
  /** Профиль: «назад» выходит из раздела профиля к списку разделов. */
  backToProfileSections: () => void
  /** Закрыть карточку приглашения (у неё своя логика очистки адреса). */
  closeInvite: () => void
  /** Выйти из режима выбора сообщений. */
  exitMessageSelection: () => void
  /** Закрыть открытую переписку (сброс нити и адреса). */
  closeOpenChat: () => void
}

export interface ChatNavigationDeps {
  /** Десктоп: там список и нить — два экрана, история приложения не нужна. */
  isDesktop: ComputedRef<boolean>
  /** Открытый раздел (Чаты/Истории/Контакты). */
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
  const { isDesktop, view, drawerOpen, selectedChatId, layers, hooks } = deps

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

  /** На мобильном: «назад» из открытого чата — снова показать список (drawer). */
  const goBackToList = () => {
    if (!isDesktop.value) {
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
    if (isDesktop.value) return
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
  /** Маркер гасим сами (программным шагом назад) — обработчик popstate молчит. */
  let programmaticBack = false
  /** Drawer открылся сам (по системному «назад») — маркер уже израсходован. */
  let drawerOpenedByBack = false
  /** Drawer открыли мы сами (переход в раздел) — чужие маркеры не гасим. */
  let drawerOpenedBySection = false

  /** Показать список разделов на мобильном (открыть drawer), не гася историю. */
  const revealDrawer = () => {
    if (isDesktop.value || drawerOpen.value) return
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
    if (isDesktop.value || handlingSystemBack) return false
    const state = window.history.state as { pismoNav?: boolean } | null
    if (!state?.pismoNav) return false
    programmaticBack = true
    try {
      router.options.history.go(-1)
    } catch {
      programmaticBack = false
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
      storyOpen: layers.storyId.value !== null,
      lightboxOpen: layers.lightboxIndex.value !== null,
      profileOpen: layers.profileOpen.value,
      profileInSection: hooks.profileInSection(),
      chatInfoOpen: layers.chatInfoOpen.value,
      groupInfoOpen: layers.groupInfoOpen.value,
      createGroupOpen: layers.createGroupOpen.value,
      inviteOpen: layers.inviteOpen(),
      messageSelection: layers.messageSelection.value,
      chatSelection: deps.chatSelection(),
      currentView: view.value,
      previousView: state?.pismoView,
      chatOpen: selectedChatId.value !== null,
      drawerOpen: drawerOpen.value,
      isDesktop: isDesktop.value
    })

    switch (step.kind) {
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
      case 'invite':
        hooks.closeInvite()
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
    // Маркер погасили сами (экран уже закрыт вручную) — обрабатывать нечего.
    if (programmaticBack) {
      programmaticBack = false
      return
    }
    if (isDesktop.value) return
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
      else stepBackInApp()
    },
    { flush: 'sync' }
  )

  /**
   * Экран поверх (модалки, просмотрщик истории, лайтбокс) закрыли ЛЮБЫМ способом —
   * крестиком, кликом по фону, жестом. Гасим маркер истории: иначе следующее
   * системное «назад» потратится на пустой шаг («назад не работает»).
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
      if (wasOpen && !open) stepBackInApp()
    },
    { flush: 'sync' }
  )

  /**
   * На мобильном список и нить — один экран. Если список открыли жестом (drawer),
   * маркер от нити больше не нужен — гасим его, иначе «назад» уйдёт впустую.
   */
  watch(
    drawerOpen,
    (open) => {
      if (!open || isDesktop.value) return
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
