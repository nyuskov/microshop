<template>
  <aside ref="rootEl" class="side-panel">
    <!-- Разделы переключаются нижним меню, поэтому шапка одна на все вкладки:
         сверху остаются только действия, которых в нижнем меню нет. -->
    <!-- Режим выделения чатов (вход по удержанию) -->
    <div v-if="selectionMode" class="selection-bar">
      <button class="icon-btn" title="Отмена" @click="exitSelection">
        <q-icon :name="icon('close')" size="20px" />
      </button>
      <span class="selection-count">{{ selectedIds.length }}</span>
      <div class="selection-actions">
        <button
          class="icon-btn"
          :class="{ on: selectionAllMuted }"
          :title="selectionAllMuted ? 'Включить уведомления' : 'Замьютить выбранные'"
          aria-label="Мьют/анмьют выбранных"
          @click="onBulkMute"
        >
          <q-icon
            :name="icon(selectionAllMuted ? 'notifications' : 'notifications_off')"
            size="20px"
          />
        </button>
        <button
          class="icon-btn"
          :class="{ on: selectionAllPinned }"
          :title="selectionAllPinned ? 'Открепить выбранные' : 'Закрепить выбранные'"
          aria-label="Пин/анпин выбранных"
          @click="onBulkPin"
        >
          <q-icon :name="icon('push_pin')" size="20px" />
        </button>
        <button
          class="icon-btn danger"
          title="Удалить выбранные"
          aria-label="Удалить выбранные"
          @click="onBulkDelete"
        >
          <q-icon :name="icon('delete')" size="20px" />
        </button>
        <button
          class="icon-btn"
          :class="{ on: allVisibleSelected }"
          title="Выбрать все"
          aria-label="Выбрать все"
          @click="toggleSelectAll"
        >
          <q-icon :name="icon('done_all')" size="20px" />
        </button>
      </div>
    </div>

    <div v-else class="panel-header">
      <!-- Значок приложения в углу шапки (как иконка мессенджера). -->
      <span class="app-mark" aria-hidden="true">
        <img src="/favicon.svg" alt="" width="34" height="34" />
      </span>

      <!-- Истории: сжатый ряд кружков рядом со значком приложения. Кликабельность
           видна по зелёному ореолу, нажатие раскрывает полосу под шапкой. -->
      <StoriesStrip
        v-if="view === 'chats'"
        mini
        @toggle-expand="toggleStoriesExpand"
        @open-story="emit('open-story', $event)"
      />

      <div class="panel-header-right">
        <button
          v-if="view === 'chats'"
          class="icon-btn"
          title="Поиск"
          aria-label="Поиск"
          @click="openSearch"
        >
          <q-icon :name="icon('search')" size="20px" />
        </button>
        <button
          v-if="view === 'contacts'"
          class="icon-btn"
          title="Добавить из контактов телефона"
          aria-label="Добавить из контактов телефона"
          @click="onAddFromPhone"
        >
          <q-icon :name="icon('contacts')" size="20px" />
        </button>
        <span ref="menuWrapEl" class="ms-dropdown-wrap" @click.stop>
          <button
            class="icon-btn"
            :class="{ open: settingsMenuOpen }"
            title="Ещё"
            aria-label="Ещё"
            @click="toggleSettingsMenu"
          >
            <q-icon :name="icon('more_vert')" size="20px" />
          </button>
          <div v-if="settingsMenuOpen" class="ms-dropdown">
            <button
              v-for="action in SETTINGS_ACTIONS"
              :key="action.key"
              class="ms-dropdown-item"
              @click="runSettingsAction(action)"
            >
              <q-icon :name="icon(action.icon)" size="19px" />
              <span>{{ action.label }}</span>
            </button>
          </div>
        </span>
        <button
          class="self-profile-btn"
          title="Настройки профиля"
          aria-label="Настройки профиля"
          @click="emit('open-profile')"
        >
          <span class="avatar self-avatar" :style="avatarStyle(selfName)">
            <img
              v-if="selfAvatarUrl"
              :src="selfAvatarUrl"
              class="avatar-img"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <template v-else>{{ selfName ? initials(selfName) : 'U' }}</template>
          </span>
        </button>
      </div>
    </div>

    <!-- Разделы меняются плавно: короткий сдвиг + затухание. -->
    <Transition name="section" mode="out-in">
      <div :key="view" class="section-body">
        <!-- Диалоги -->
        <template v-if="view === 'stories'">
          <div class="chat-scroll">
            <StoriesFeed @open-story="emit('open-story', $event)" />
          </div>
        </template>

        <template v-else-if="view === 'chats'">
          <!-- Глобальный поиск: раскрывается на месте шапки (как в Telegram),
           плавно — поэтому обёрнут в Transition и держит высоту сам. -->
          <Transition name="search-expand">
            <div v-if="!selectionMode && searchOpen" class="panel-search search-head">
              <button
                class="icon-btn search-back"
                title="Назад"
                aria-label="Назад"
                @click="closeSearch"
              >
                <q-icon :name="icon('arrow_back')" size="20px" />
              </button>
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                class="panel-search-input"
                type="text"
                placeholder="Поиск людей и сообщений"
                aria-label="Глобальный поиск"
                @keydown.esc="closeSearch"
              />
              <button
                v-if="searchQuery.trim()"
                class="icon-btn search-clear"
                title="Очистить"
                aria-label="Очистить"
                @click="searchQuery = ''"
              >
                <q-icon :name="icon('close')" size="18px" />
              </button>
            </div>
          </Transition>

          <div v-if="searchError" class="inline-error">{{ searchError }}</div>

          <!-- Результаты поиска: люди / сообщения -->
          <div v-if="searchOpen && searchQuery.trim()" class="people-results">
            <div class="search-mode-tabs" role="tablist" aria-label="Область поиска">
              <button
                class="search-mode-tab"
                :class="{ active: searchMode === 'people' }"
                role="tab"
                :aria-selected="searchMode === 'people'"
                @click="setSearchMode('people')"
              >
                Люди
              </button>
              <button
                class="search-mode-tab"
                :class="{ active: searchMode === 'messages' }"
                role="tab"
                :aria-selected="searchMode === 'messages'"
                @click="setSearchMode('messages')"
              >
                Сообщения
              </button>
            </div>

            <div v-if="searching" class="search-status">Поиск…</div>

            <!-- Люди -->
            <template v-else-if="searchMode === 'people' && userResults.length">
              <div class="section-label">Найти людей</div>
              <button
                v-for="user in userResults"
                :key="user.id"
                class="row-item"
                @click="openChatWithUser(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img
                    v-if="avatarUrlOf(user)"
                    :src="avatarUrlOf(user)"
                    class="avatar-img"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-title">
                    <template v-for="(part, i) in parts(displayName(user))" :key="'n' + i">
                      <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <span class="row-sub">
                    <template v-for="(part, i) in parts('@' + user.username)" :key="'u' + i">
                      <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                    <template v-if="user.phone_number"> · {{ user.phone_number }}</template>
                  </span>
                </span>
                <q-icon :name="icon('chevron_right')" class="row-arrow" size="20px" />
              </button>
            </template>
            <div v-else-if="searchMode === 'people'" class="search-status">Никого не найдено</div>

            <!-- Сообщения (по всем диалогам) -->
            <template v-else-if="searchMode === 'messages' && messageResults.length">
              <div class="section-label">Найдено в чатах</div>
              <button
                v-for="msg in messageResults"
                :key="msg.id"
                class="row-item"
                @click="openMessageResult(msg)"
              >
                <span class="avatar" :style="avatarStyle(messageChatTitle(msg))">
                  <img
                    v-if="messageChatAvatar(msg)"
                    :src="messageChatAvatar(msg)"
                    class="avatar-img"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(messageChatTitle(msg)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-line">
                    <span class="row-title msg-result-chat">{{ messageChatTitle(msg) }}</span>
                    <span class="row-time">{{ formatMsgTime(msg.timestamp) }}</span>
                  </span>
                  <span class="row-sub msg-result-snippet">
                    {{ messageSenderPrefix(msg)
                    }}<template v-for="(part, i) in parts(messageSnippetText(msg))" :key="'s' + i">
                      <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </span>
                <q-icon :name="icon('chevron_right')" class="row-arrow" size="20px" />
              </button>
            </template>
            <div v-else-if="searchMode === 'messages'" class="search-status">Ничего не найдено</div>
          </div>

          <!-- Скелетоны: показываем структуру списка вместо текста «Загрузка…» -->
          <div v-if="!searchOpen && loadingChats" class="sk-list" aria-busy="true">
            <span class="sr-only">Загрузка диалогов…</span>
            <div v-for="n in 6" :key="n" class="sk-row">
              <span class="sk-avatar"></span>
              <span class="sk-lines">
                <span class="sk-line" :style="{ width: 40 + ((n * 13) % 35) + '%' }"></span>
                <span class="sk-line short"></span>
              </span>
            </div>
          </div>

          <!-- Недавние диалоги (скрыты, пока открыт глобальный поиск) -->
          <template v-else-if="!searchOpen">
            <!-- Истории: раскрытая полоса под шапкой. Появляется по нажатию на
                 кружки в шапке или по протяжке списка вниз у самого верха. -->
            <Transition name="stories-drop">
              <div v-if="storiesExpanded" class="stories-collapse">
                <StoriesStrip @open-story="emit('open-story', $event)" />
              </div>
            </Transition>
            <!-- Фильтры списка: быстро отсечь непрочитанное, личные или группы -->
            <div
              v-if="!selectionMode"
              class="chat-filters"
              role="tablist"
              aria-label="Фильтр чатов"
            >
              <button
                v-for="filter in CHAT_FILTERS"
                :key="filter.key"
                type="button"
                class="chat-filter"
                :class="{ active: chatFilter === filter.key }"
                role="tab"
                :aria-selected="chatFilter === filter.key"
                @click="chatFilter = filter.key"
              >
                {{ filter.title }}
                <span v-if="filter.key === 'unread' && unreadChatCount" class="chat-filter-count">
                  {{ unreadChatCount > 99 ? '99+' : unreadChatCount }}
                </span>
              </button>
            </div>
            <div class="section-label">Недавние</div>
            <div v-if="!orderedChats.length" class="empty-hint">
              Найдите пользователя по логину или телефону и начните переписку
            </div>
            <div
              ref="chatsScrollEl"
              class="chat-scroll"
              @scroll.passive="onChatsScroll"
              @touchstart.passive="onListTouchStart"
              @touchmove.passive="onListTouchMove"
            >
              <div v-for="chat in orderedChats" :key="chat.id" class="chat-row">
                <button
                  class="row-item"
                  :class="{
                    active: !selectionMode && selectedChatId === chat.id,
                    selected: isSelected(chat.id)
                  }"
                  @pointerdown="onRowPointerDown(chat.id)"
                  @pointerup="onRowPointerUp"
                  @pointercancel="onRowPointerCancel"
                  @pointerleave="onRowPointerUp"
                  @click="onRowClick(chat.id)"
                >
                  <span
                    v-if="selectionMode"
                    class="row-selector"
                    :class="{ on: isSelected(chat.id) }"
                  >
                    <q-icon v-if="isSelected(chat.id)" :name="icon('check')" size="15px" />
                  </span>
                  <span class="avatar-wrap" :class="{ online: chatPeerOnline(chat) }">
                    <span
                      class="avatar"
                      :style="chat.is_self ? savedStyle : avatarStyle(chatTitleOf(chat))"
                    >
                      <q-icon
                        v-if="chat.is_self"
                        :name="icon('bookmark')"
                        size="20px"
                        aria-hidden="true"
                      />
                      <img
                        v-else-if="chatAvatarOf(chat)"
                        :src="chatAvatarOf(chat)"
                        class="avatar-img"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <template v-else>{{ initials(chatTitleOf(chat)) }}</template>
                    </span>
                  </span>
                  <span class="row-text">
                    <span class="row-line">
                      <span class="row-title">
                        <q-icon
                          v-if="chat.is_channel"
                          :name="icon('campaign')"
                          size="15px"
                          class="row-channel"
                          aria-hidden="true"
                        />
                        {{ chatTitleOf(chat) }}
                      </span>
                      <span class="row-time">
                        <q-icon
                          v-if="isMutedOf(chat.id)"
                          :name="icon('notifications_off')"
                          size="14px"
                          class="row-muted"
                          aria-hidden="true"
                        />
                        {{ chat.last_message ? formatChatTime(chat.last_message.timestamp) : '' }}
                      </span>
                    </span>
                    <span class="row-line">
                      <span
                        class="row-sub preview"
                        :class="{ typing: isChatTyping(chat), draft: draftOf(chat) !== null }"
                      >
                        <template v-if="isChatTyping(chat)">печатает…</template>
                        <template v-else-if="draftOf(chat)">Черновик: {{ draftOf(chat) }}</template>
                        <template v-else>
                          <q-icon
                            v-if="lastMessageIsOut(chat)"
                            :name="icon('done')"
                            class="tick"
                            size="16px"
                          />
                          {{ previewText(chat) }}
                        </template>
                      </span>
                      <span v-if="chat.unread_count > 0" class="unread-badge">
                        {{ chat.unread_count }}
                      </span>
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </template>

          <!-- Пустой глобальный поиск: подсказка вместо списка -->
          <template v-else-if="searchOpen && !searchQuery.trim()">
            <div class="search-hint">
              <q-icon :name="icon('search')" class="search-hint-icon" size="30px" />
              <p>Поиск по людям и сообщениям<br />во всех чатах</p>
            </div>
          </template>
        </template>

        <!-- Контакты -->
        <template v-else>
          <div class="panel-search">
            <q-icon :name="icon('search')" class="search-icon" size="17px" />
            <input
              v-model="contactsQuery"
              class="panel-search-input"
              type="text"
              placeholder="Поиск по логину или телефону"
              aria-label="Поиск контактов"
            />
          </div>

          <!-- Результаты импорта из телефонной книги (показываются прямо в списке) -->
          <div v-if="phoneMatched !== null && !phoneImportOpen" class="phone-inline">
            <div class="phone-inline-head">
              <span class="phone-result-title">
                Из телефонной книги: {{ phoneMatched.length }}
              </span>
              <button
                class="phone-inline-clear"
                title="Закрыть результаты"
                aria-label="Закрыть результаты"
                @click="clearPhoneMatch"
              >
                <q-icon :name="icon('close')" size="18px" />
              </button>
            </div>
            <p v-if="phoneError" class="phone-error">{{ phoneError }}</p>
            <div v-if="!phoneBusy && !phoneMatched.length" class="empty-hint">
              Никого из вашей книги нет в мессенджере
            </div>
            <div v-else class="phone-inline-list">
              <button
                v-for="user in phoneMatched"
                :key="user.id"
                class="row-item"
                @click="openPhoneMatch(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img
                    v-if="avatarUrlOf(user)"
                    :src="avatarUrlOf(user)"
                    class="avatar-img"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-title">{{ displayName(user) }}</span>
                  <span class="row-sub"
                    >@{{ user.username
                    }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template></span
                  >
                </span>
                <q-icon :name="icon('chat_bubble')" class="row-arrow" size="18px" />
              </button>
            </div>
          </div>

          <!-- Список контактов: моя записная книжка (кого я добавил) -->
          <template v-if="phoneMatched === null || phoneImportOpen">
            <div v-if="contactsLoading" class="sk-list" aria-busy="true">
              <span class="sr-only">Загрузка контактов…</span>
              <div v-for="n in 6" :key="n" class="sk-row">
                <span class="sk-avatar"></span>
                <span class="sk-lines">
                  <span class="sk-line" :style="{ width: 35 + ((n * 17) % 40) + '%' }"></span>
                  <span class="sk-line short"></span>
                </span>
              </div>
            </div>

            <template v-else>
              <!-- Найденные в мессенджере (по поиску) — кого можно добавить -->
              <div v-if="contactsSearchBusy" class="search-status" aria-busy="true">
                Ищем людей…
              </div>
              <template v-else-if="foundNotInContacts.length">
                <div class="section-label">Найдены в мессенджере</div>
                <div class="people-results">
                  <div v-for="user in foundNotInContacts" :key="user.id" class="contact-row">
                    <button class="row-item" @click="openChatWithContact(user)">
                      <span class="avatar" :style="avatarStyle(displayName(user))">
                        <img
                          v-if="avatarUrlOf(user)"
                          :src="avatarUrlOf(user)"
                          class="avatar-img"
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                        <template v-else>{{ initials(displayName(user)) }}</template>
                      </span>
                      <span class="row-text">
                        <span class="row-title">{{ displayName(user) }}</span>
                        <span class="row-sub">@{{ user.username }}</span>
                      </span>
                    </button>
                    <button
                      class="contact-action"
                      title="Добавить в контакты"
                      aria-label="Добавить в контакты"
                      @click="openContactName(user)"
                    >
                      <q-icon :name="icon('person_add')" size="18px" />
                    </button>
                  </div>
                </div>
              </template>

              <p v-if="contactsSearchError" class="cn-side-error">{{ contactsSearchError }}</p>

              <div v-if="!filteredContacts.length && !foundNotInContacts.length" class="empty-hint">
                {{
                  contactsQuery.trim()
                    ? 'Никого не нашли — проверьте логин или телефон'
                    : 'Контактов пока нет. Найдите человека по логину или телефону и добавьте его.'
                }}
              </div>

              <div v-else-if="filteredContacts.length" class="chat-scroll">
                <div v-for="contact in filteredContacts" :key="contact.id" class="contact-row">
                  <button class="row-item" @click="openChatWithContact(contact)">
                    <span class="avatar" :style="avatarStyle(displayName(contact))">
                      <img
                        v-if="avatarUrlOf(contact)"
                        :src="avatarUrlOf(contact)"
                        class="avatar-img"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <template v-else>{{ initials(displayName(contact)) }}</template>
                    </span>
                    <span class="row-text">
                      <span class="row-title">{{ displayName(contact) }}</span>
                      <span class="row-sub"
                        >@{{ contact.username
                        }}<template v-if="contact.phone_number">
                          · {{ contact.phone_number }}</template
                        ></span
                      >
                    </span>
                  </button>
                  <button
                    class="contact-action"
                    title="Имя контакта"
                    aria-label="Имя контакта"
                    @click="openContactName(contact)"
                  >
                    <q-icon :name="icon('edit')" size="17px" />
                  </button>
                </div>
              </div>
            </template>
          </template>
        </template>
      </div>
    </Transition>

    <!-- Нижняя навигация: основные разделы приложения -->
    <nav class="bottom-nav" aria-label="Разделы">
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'chats' }"
        type="button"
        @click="emit('to-chats')"
      >
        <q-icon :name="icon('forum')" size="22px" />
        <span>Чаты</span>
        <span v-if="unreadCount" class="bottom-nav-badge">{{
          unreadCount > 99 ? '99+' : unreadCount
        }}</span>
      </button>
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'stories' }"
        type="button"
        @click="emit('to-stories')"
      >
        <q-icon :name="icon('auto_stories')" size="22px" />
        <span>Истории</span>
        <span v-if="storiesStore.hasUnseen" class="bottom-nav-dot"></span>
      </button>
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'contacts' }"
        type="button"
        @click="emit('to-contacts')"
      >
        <q-icon :name="icon('group')" size="22px" />
        <span>Контакты</span>
      </button>
    </nav>

    <!-- Личное имя контакта: добавление / переименование / удаление -->
    <ContactNameDialog
      v-if="contactDialogUser"
      v-model="contactDialogOpen"
      :user="contactDialogUser"
    />
  </aside>

  <!-- Импорт контактов из телефонной книги -->
  <Teleport to="body">
    <div
      v-if="phoneImportOpen"
      class="phone-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Добавить из контактов телефона"
      @mousedown.self="closePhoneImport"
    >
      <div class="phone-card">
        <header class="phone-head">
          <div class="phone-title">
            <q-icon :name="icon('contacts')" size="18px" />
            <span>Из контактов телефона</span>
          </div>
          <button class="phone-xbtn" title="Закрыть" @click="closePhoneImport">
            <q-icon :name="icon('close')" size="20px" />
          </button>
        </header>

        <div class="phone-body">
          <button
            v-if="phoneContactsSupported"
            class="phone-primary"
            :disabled="phoneBusy"
            @click="pickDeviceContacts"
          >
            <q-icon :name="icon('phone_android')" size="20px" />
            <span>{{ phoneBusy ? 'Открываем…' : 'Выбрать из телефонной книги' }}</span>
          </button>
          <p v-else class="phone-hint">
            Браузер не открывает книгу напрямую — вставьте номера ниже (по одному в строке).
          </p>

          <div class="phone-or"><span>или</span></div>

          <label class="phone-label" for="phone-textarea">Номера телефонов</label>
          <textarea
            id="phone-textarea"
            v-model="manualPhones"
            class="phone-textarea"
            rows="5"
            placeholder="+7 999 123-45-67&#10;+7 912 000-00-00"
          ></textarea>

          <div class="phone-actions">
            <button class="phone-btn ghost" :disabled="phoneBusy" @click="closePhoneImport">
              Отмена
            </button>
            <button class="phone-btn primary" :disabled="phoneBusy" @click="findByManualPhones">
              {{ phoneBusy ? 'Поиск…' : 'Найти в мессенджере' }}
            </button>
          </div>

          <p v-if="phoneError" class="phone-error">{{ phoneError }}</p>

          <template v-if="phoneMatched !== null">
            <p class="phone-result-title">Найдено в мессенджере: {{ phoneMatched.length }}</p>
            <div v-if="!phoneMatched.length" class="phone-empty">
              Никого из вашей книги нет в мессенджере
            </div>
            <div v-else class="phone-results">
              <button
                v-for="user in phoneMatched"
                :key="user.id"
                class="phone-row"
                @click="openPhoneMatch(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img
                    v-if="avatarUrlOf(user)"
                    :src="avatarUrlOf(user)"
                    class="avatar-img"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="phone-row-text">
                  <span class="phone-row-name">{{ displayName(user) }}</span>
                  <span class="phone-row-phone">@{{ user.username }}</span>
                </span>
                <q-icon :name="icon('chat_bubble')" class="phone-row-icon" size="18px" />
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { useStoriesStore } from '@/stores/stories'
import StoriesFeed from '@/components/stories/StoriesFeed.vue'
import StoriesStrip from '@/components/stories/StoriesStrip.vue'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import {
  matchUsersByPhone,
  openPrivateChat,
  searchMessages,
  searchUsers,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatTitle,
  displayName,
  groupAvatarUrl,
  initials,
  isGroupChat
} from '@/utils/user'
import { splitByQuery } from '@/utils/search'
import { formatChatTime, formatMsgTime } from '@/utils/format'
import { isLockedFile, lockedFileLabel, mediaTypeLabel } from '@/utils/media'
import { plainMessageText } from '@/utils/mentions'

const props = defineProps<{
  view: 'chats' | 'contacts' | 'stories'
  currentUserId: number | null
  chats: Chat[]
  contacts: ChatUser[]
  selectedChatId: number | null
  loadingChats: boolean
  contactsLoading: boolean
  /** id пользователей, которые сейчас «в сети» (присутствие из WS). */
  onlineUserIds?: number[]
  /** id чатов, где собеседник сейчас печатает. */
  typingChatIds?: number[]
  /** id закреплённых чатов (показываются вверху списка). */
  pinnedChatIds?: number[]
  /** id замьюченных чатов (без всплывающих уведомлений). */
  mutedChatIds?: number[]
  /** Сохранённые черновики по id чата (показываются в превью). */
  drafts?: Record<number, string>
  /** Имя и аватар текущего пользователя (кнопка «Настройки профиля»). */
  selfName: string
  selfAvatarUrl: string | undefined
  /** Администратор: показывает в «⋯» разбор жалоб. */
  isAdmin?: boolean
  /** Всего непрочитанных сообщений (бейдж на вкладке «Чаты»). */
  unreadCount?: number
}>()

const storiesStore = useStoriesStore()

const emit = defineEmits<{
  (e: 'to-contacts'): void
  (e: 'to-stories'): void
  (e: 'open-story', storyId: number): void
  (e: 'to-chats'): void
  (e: 'open-profile'): void
  (e: 'select-chat', chatId: number): void
  (e: 'chat-opened', chat: Chat): void
  (e: 'open-message', chatId: number, messageId: number): void
  (e: 'toggle-pin', chatId: number): void
  (e: 'toggle-mute', chatId: number): void
  (e: 'delete-chat', chat: Chat): void
  (e: 'bulk-mute', chatIds: number[], muted: boolean): void
  (e: 'bulk-pin', chatIds: number[], pinned: boolean): void
  (e: 'bulk-delete', chatIds: number[]): void
  /** Открыть диалог «Новая группа». */
  (e: 'create-group'): void
  /** Открыть диалог «Новый канал». */
  (e: 'create-channel'): void
  /** Открыть список заблокированных пользователей. */
  (e: 'open-blocked'): void
  /** Открыть разбор жалоб (только администраторы). */
  (e: 'open-reports'): void
}>()

/** Пункт меню «⋯»: иконка Material + подпись. */
interface SettingsAction {
  key: 'group' | 'channel' | 'blocked' | 'reports'
  label: string
  icon: string
}

// Пункты верхнего меню «⋯»; «Жалобы» видят только администраторы.
const SETTINGS_ACTIONS = computed<SettingsAction[]>(() => {
  const items: SettingsAction[] = [
    { key: 'group', label: 'Новая группа', icon: 'group_add' },
    { key: 'channel', label: 'Новый канал', icon: 'campaign' },
    { key: 'blocked', label: 'Заблокированные', icon: 'block' }
  ]
  if (props.isAdmin) items.push({ key: 'reports', label: 'Жалобы', icon: 'flag' })
  return items
})

/**
 * Истории: в шапке лежат сжатые кружки, а сама полоса раскрывается под шапкой.
 *
 * Раскрыть можно нажатием на кружки в шапке или протяжкой списка вниз у самого
 * верха; прокрутка списка вниз — снова сжимает (как в Telegram). Выбор
 * запоминаем, чтобы после перезапуска всё осталось как у человека было.
 */
const STORIES_EXPANDED_KEY = 'pismo_stories_expanded'
const readStoriesExpanded = (): boolean => {
  try {
    return localStorage.getItem(STORIES_EXPANDED_KEY) === '1'
  } catch {
    /* localStorage недоступен — считаем, что полоса сжата */
    return false
  }
}
const storiesExpanded = ref(readStoriesExpanded())

const setStoriesExpanded = (value: boolean) => {
  if (storiesExpanded.value === value) return
  storiesExpanded.value = value
  try {
    localStorage.setItem(STORIES_EXPANDED_KEY, value ? '1' : '0')
  } catch {
    /* приватный режим — выбор запомнится только до перезагрузки */
  }
}

const toggleStoriesExpand = () => setStoriesExpanded(!storiesExpanded.value)

const chatsScrollEl = ref<HTMLElement | null>(null)
// Копим движение в пределах шага: без этого микро-дрожание скролла мигало бы полосой.
const STORIES_SCROLL_STEP = 24
let storiesScrollAcc = 0
let storiesLastTop = 0
let storiesRaf = 0
const onChatsScroll = () => {
  if (storiesRaf) return
  storiesRaf = requestAnimationFrame(() => {
    storiesRaf = 0
    const el = chatsScrollEl.value
    if (!el) return
    const top = el.scrollTop
    const delta = top - storiesLastTop
    storiesLastTop = top
    // У самого верха списка ничего не сжимаем: там работает протяжка вниз.
    if (top <= 8) {
      storiesScrollAcc = 0
      return
    }
    const step = STORIES_SCROLL_STEP
    storiesScrollAcc = Math.max(-step, Math.min(step, storiesScrollAcc + delta))
    if (storiesScrollAcc >= step) {
      storiesScrollAcc = 0
      setStoriesExpanded(false)
    }
  })
}

/**
 * Протяжка списка вниз у самого верха раскрывает истории — жест «потянуть»,
 * как в Telegram. Срабатывает один раз на касание.
 */
const PULL_EXPAND_PX = 48
let pullStartY = 0
let pullUsed = false
const onListTouchStart = (event: TouchEvent) => {
  pullStartY = event.touches[0]?.clientY ?? 0
  pullUsed = false
}
const onListTouchMove = (event: TouchEvent) => {
  const el = chatsScrollEl.value
  if (!el || pullUsed || storiesExpanded.value || el.scrollTop > 0) return
  const y = event.touches[0]?.clientY ?? 0
  if (y - pullStartY < PULL_EXPAND_PX) return
  pullUsed = true
  setStoriesExpanded(true)
}

// Список пересоздаётся при смене раздела и при открытии поиска — отсчёт заново.
watch(chatsScrollEl, (el) => {
  storiesLastTop = el?.scrollTop ?? 0
  storiesScrollAcc = 0
})
onBeforeUnmount(() => {
  if (storiesRaf) cancelAnimationFrame(storiesRaf)
})
const rootEl = ref<HTMLElement | null>(null)
/** Обёртка меню «⋯» (кнопка + выпадающий список) — по ней считаем «клик мимо». */
const menuWrapEl = ref<HTMLElement | null>(null)
const settingsMenuOpen = ref(false)
// Тап/клик мимо меню закрывает «⋯».
//
// ВАЖНО: «мимо» считаем относительно самого меню, а не всей панели: на телефоне
// панель занимает весь экран, и тап «в сторону» попадал ВНУТРЬ панели — меню
// не закрывалось (выглядело как «залипло»).
let outsideHandler: ((event: PointerEvent) => void) | null = null
watch(settingsMenuOpen, (open) => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
  if (open) {
    outsideHandler = (event: PointerEvent) => {
      const wrap = menuWrapEl.value
      if (wrap && !wrap.contains(event.target as Node)) settingsMenuOpen.value = false
    }
    document.addEventListener('pointerdown', outsideHandler)
  }
})

const searchQuery = ref('')
const searching = ref(false)
const searchMode = ref<'people' | 'messages'>('people')
const userResults = ref<SearchUserResult[]>([])
const messageResults = ref<Message[]>([])
const searchError = ref('')
const contactsQuery = ref('')
// Поиск по всему мессенджеру в разделе «Контакты»: найденных показываем
// отдельным блоком с кнопкой «добавить в контакты» (как в Telegram).
const foundUsers = ref<SearchUserResult[]>([])
const contactsSearchBusy = ref(false)
const contactsSearchError = ref('')
let contactsTimer: number | null = null
/** Диалог «Добавить в контакты / Имя контакта». */
const contactDialogOpen = ref(false)
const contactDialogUser = ref<ChatUser | null>(null)

const openContactName = (user: ChatUser | SearchUserResult) => {
  contactDialogUser.value = user as ChatUser
  contactDialogOpen.value = true
}

/**
 * Найденные в мессенджере за вычетом тех, кого уже добавили.
 *
 * Список результатов поиска не трогаем (он живёт до следующего запроса), а
 * фильтруем на отображении: после нажатия «+» человек сразу пропадает из
 * блока «Найдены в мессенджере» и появляется в моих контактах.
 */
const foundNotInContacts = computed<SearchUserResult[]>(() => {
  const mine = new Set(props.contacts.map((contact) => contact.id))
  return foundUsers.value.filter((user) => !mine.has(user.id))
})

// Минимальная длина запроса: короче — слишком много совпадений (и лишний трафик).
const CONTACTS_SEARCH_MIN = 2

watch(contactsQuery, (value) => {
  if (contactsTimer !== null) {
    window.clearTimeout(contactsTimer)
    contactsTimer = null
  }
  contactsSearchError.value = ''
  const query = value.trim()
  if (query.length < CONTACTS_SEARCH_MIN) {
    foundUsers.value = []
    contactsSearchBusy.value = false
    return
  }
  contactsSearchBusy.value = true
  contactsTimer = window.setTimeout(async () => {
    try {
      const results = await searchUsers(query)
      // Уже добавленные и я сам — не предлагаем повторно.
      const mine = new Set(props.contacts.map((contact) => contact.id))
      foundUsers.value = results.filter(
        (user) => !mine.has(user.id) && user.id !== props.currentUserId
      )
    } catch (error) {
      contactsSearchError.value = getErrorMessage(error, 'Не удалось выполнить поиск')
    } finally {
      contactsSearchBusy.value = false
    }
  }, 300)
})

onBeforeUnmount(() => {
  if (contactsTimer !== null) window.clearTimeout(contactsTimer)
})

const searchInputRef = ref<HTMLInputElement | null>(null)

/** Части текста с подсветкой совпадений по текущему запросу. */
const parts = (text: string) => splitByQuery(text, searchQuery.value)

const chatPeerOf = (chat: Chat) => chatPeer(chat, props.currentUserId)
const chatTitleOf = (chat: Chat): string => chatTitle(chat, props.currentUserId)
/** Аватар чата: у группы — своё фото, у личного — аватар собеседника. */
const chatAvatarOf = (chat: Chat): string | undefined =>
  isGroupChat(chat) ? groupAvatarUrl(chat) : avatarUrlOf(chatPeerOf(chat))
// Аватар-«книжечка» для «Сохранённых сообщений».
const savedStyle: Record<string, string> = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)'
}

/**
 * «В сети»: только явное присутствие из WS-канала.
 *
 * Раньше здесь был ещё фоллбэк по `last_seen` (±30 секунд), и при свёрнутом
 * приложении зелёная точка загоралась после каждого heartbeat — собеседник видел
 * «онлайн» у того, кто давно ушёл. Теперь источник правды один — `presence`.
 */
const isUserOnline = (user: ChatUser | undefined | null): boolean =>
  !!user && (props.onlineUserIds?.includes(user.id) ?? false)

/** Индикатор онлайн показываем только у личных (1-1) чатов. */
const chatPeerOnline = (chat: Chat): boolean => {
  if (chat.users.length !== 2) return false
  return isUserOnline(chatPeerOf(chat))
}

/** Печатает ли сейчас собеседник в этом чате. */
const isChatTyping = (chat: Chat): boolean =>
  chat.users.length === 2 && (props.typingChatIds?.includes(chat.id) ?? false)

/** Закреплён ли чат. */
const isPinnedOf = (chatId: number): boolean => props.pinnedChatIds?.includes(chatId) ?? false

/** Замьючен ли чат. */
const isMutedOf = (chatId: number): boolean => props.mutedChatIds?.includes(chatId) ?? false

// ---------- Режим выделения чатов (long-press; как в Telegram) ----------
// Вход: удержание на чате (~0,5 с). В режиме выделения клик по чату —
// отметить/снять; сверху появляется панель действий (мьют/удалить/выбрать все).
const selectionMode = ref(false)
const selectedIds = ref<number[]>([])

const isSelected = (chatId: number): boolean => selectedIds.value.includes(chatId)

const exitSelection = () => {
  selectionMode.value = false
  selectedIds.value = []
}

// Родителю нужен режим выделения: системная «назад» должна выходить из него
// (см. `onAppPopState` в Messenger.vue). Отдаём функции — так не важно, как Vue
// разворачивает ref'ы при доступе к дочернему компоненту.
const isSelecting = () => selectionMode.value
/**
 * Горячие клавиши на десктопе: ↑/↓ — соседний чат, Ctrl/⌘+F — поиск.
 * В полях ввода клавиши не перехватываем.
 */
const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

const onHotkeys = (event: KeyboardEvent) => {
  if (props.view !== 'chats' || selectionMode.value) return
  const meta = event.ctrlKey || event.metaKey
  if (meta && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openSearch()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (meta || event.altKey || event.shiftKey) return
  if (isTypingTarget(event.target) || searchOpen.value) return
  const list = orderedChats.value.filter((chat) => !chat.is_self)
  if (!list.length) return
  event.preventDefault()
  const currentIndex = list.findIndex((chat) => chat.id === props.selectedChatId)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex =
    currentIndex === -1 ? 0 : Math.min(list.length - 1, Math.max(0, currentIndex + step))
  emit('select-chat', list[nextIndex].id)
}

onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))

defineExpose({ exitSelection, isSelecting, selectionMode })

const toggleSelect = (chatId: number) => {
  const next = new Set(selectedIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  selectedIds.value = Array.from(next)
  if (selectedIds.value.length === 0) selectionMode.value = false
}

let holdTimer: number | null = null
let suppressClick = false

const cancelHold = () => {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer)
    holdTimer = null
  }
}

const onRowPointerDown = (chatId: number) => {
  if (selectionMode.value) return
  cancelHold()
  suppressClick = false
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    selectionMode.value = true
    selectedIds.value = [chatId]
    suppressClick = true // клик, которым завершилось удержание, чат не открывает
  }, 480)
}

const onRowPointerUp = () => {
  cancelHold()
}

const onRowPointerCancel = () => {
  cancelHold()
  suppressClick = false
}

const onRowClick = (chatId: number) => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (selectionMode.value) {
    toggleSelect(chatId)
    return
  }
  selectChat(chatId)
}

const allVisibleSelected = computed<boolean>(() => {
  const visible = orderedChats.value.map((chat) => chat.id)
  return visible.length > 0 && visible.every((id) => selectedIds.value.includes(id))
})

const selectionAllMuted = computed<boolean>(() => {
  if (selectedIds.value.length === 0) return false
  return selectedIds.value.every((id) => isMutedOf(id))
})

const selectionAllPinned = computed<boolean>(() => {
  if (selectedIds.value.length === 0) return false
  return selectedIds.value.every((id) => isPinnedOf(id))
})

const toggleSelectAll = () => {
  if (allVisibleSelected.value) {
    exitSelection()
  } else {
    selectedIds.value = orderedChats.value.map((chat) => chat.id)
    if (selectedIds.value.length === 0) selectionMode.value = false
  }
}

const onBulkMute = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const muted = !selectionAllMuted.value
  exitSelection()
  emit('bulk-mute', ids, muted)
}

const onBulkPin = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const pinned = !selectionAllPinned.value
  exitSelection()
  emit('bulk-pin', ids, pinned)
}

const onBulkDelete = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  exitSelection()
  emit('bulk-delete', ids)
}

// Выход из режима выделения при внешних изменениях (смена вкладки/чата).
watch([() => props.view, () => props.selectedChatId], () => {
  if (selectionMode.value) exitSelection()
})

/** Сохранённый черновик чата (null — черновика нет). */
const draftOf = (chat: Chat): string | null => {
  const text = props.drafts?.[chat.id]
  return text && text.trim() ? text : null
}

/** Фильтры списка чатов: все / непрочитанные / личные / группы / каналы. */
type ChatFilterKey = 'all' | 'unread' | 'private' | 'groups' | 'channels'

const CHAT_FILTERS: { key: ChatFilterKey; title: string }[] = [
  { key: 'all', title: 'Все' },
  { key: 'unread', title: 'Непрочитанные' },
  { key: 'private', title: 'Личные' },
  { key: 'groups', title: 'Группы' },
  { key: 'channels', title: 'Каналы' }
]

const chatFilter = ref<ChatFilterKey>('all')

/** Сколько чатов с непрочитанными — счётчик на фильтре. */
const unreadChatCount = computed(
  () => props.chats.filter((chat) => (chat.unread_count ?? 0) > 0).length
)

/** Чаты после фильтра и поиска по названию. */
const filteredChats = computed<Chat[]>(() => {
  const byFilter = props.chats.filter((chat) => {
    if (chatFilter.value === 'unread') return (chat.unread_count ?? 0) > 0
    // Канал — тоже групповой чат, поэтому в «Группах» его не показываем.
    if (chatFilter.value === 'groups') return isGroupChat(chat) && !chat.is_channel
    if (chatFilter.value === 'channels') return !!chat.is_channel
    if (chatFilter.value === 'private') return !isGroupChat(chat)
    return true
  })
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return byFilter
  return byFilter.filter((chat) => {
    const title = chatTitleOf(chat)
    const peer = chatPeerOf(chat)
    const phone = peer?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
})

/** Чаты для показа: «Сохранённые сообщения», затем закреплённые, затем остальные. */
const orderedChats = computed<Chat[]>(() => {
  const pinned = new Set(props.pinnedChatIds ?? [])
  const self = filteredChats.value.filter((chat) => chat.is_self)
  const others = filteredChats.value.filter((chat) => !chat.is_self)
  if (pinned.size === 0) return [...self, ...others]
  const top = others.filter((chat) => pinned.has(chat.id))
  const rest = others.filter((chat) => !pinned.has(chat.id))
  return [...self, ...top, ...rest]
})

const filteredContacts = computed<ChatUser[]>(() => {
  const query = contactsQuery.value.trim().toLowerCase()
  if (!query) return props.contacts
  return props.contacts.filter((contact) =>
    [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(query))
  )
})

const lastMessageIsOut = (chat: Chat): boolean => {
  const last = chat.last_message
  return !!last && props.currentUserId !== null && last.user_id === props.currentUserId
}

const previewText = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  // Скрытое модерацией: сервер не отдаёт ни текст, ни файл — показываем пометку,
  // а не пустую строку (иначе выглядит как сбой).
  if (last.hidden) return 'Скрыто до проверки модератором'
  // Зашифрованное вложение: содержимое и имя файла серверу неизвестны.
  if (isLockedFile(last)) return lockedFileLabel(last)
  if (last.encrypted && isEncryptedPayload(last.text)) return '🔒 Сообщение'
  const me = props.currentUserId
  const mine = me !== null && last.user_id === me
  let prefix = mine ? 'Вы: ' : ''
  if (!mine && isGroupChat(chat)) {
    const author = chat.users.find((user) => user.id === last.user_id)
    if (author) prefix = `${displayName(author)}: `
  }
  const body = last.file ? mediaTypeLabel(last.file) : plainMessageText(last.text)
  if (last.forwarded_from) return `${prefix}↪ Переслано: ${body}`
  return `${prefix}${body}`
}

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

const runSettingsAction = (action: SettingsAction) => {
  settingsMenuOpen.value = false
  if (action.key === 'group') emit('create-group')
  if (action.key === 'channel') emit('create-channel')
  if (action.key === 'blocked') emit('open-blocked')
  if (action.key === 'reports') emit('open-reports')
}

const searchOpen = ref(false)

/** Открыть глобальный поиск (прячет верхний хидер, фокус в поле). */
const openSearch = () => {
  settingsMenuOpen.value = false
  searchOpen.value = true
  requestAnimationFrame(() => searchInputRef.value?.focus())
}

/** Закрыть глобальный поиск и сбросить запрос. */
const closeSearch = () => {
  searchOpen.value = false
  searchQuery.value = ''
  userResults.value = []
  messageResults.value = []
  searching.value = false
  searchError.value = ''
}

const selectChat = (chatId: number) => {
  settingsMenuOpen.value = false
  emit('select-chat', chatId)
}

/** Открытие приватного чата с найденным по поиску пользователем. */
const openChatWithUser = async (user: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(user.id)
    closeSearch()
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

const setSearchMode = (mode: 'people' | 'messages') => {
  searchMode.value = mode
}

/** Чат, в котором лежит найденное сообщение. */
const chatOfMessage = (message: Message): Chat | undefined =>
  props.chats.find((chat) => chat.id === message.chat_id)

/** Название чата для результата поиска по сообщениям. */
const messageChatTitle = (message: Message): string => {
  const chat = chatOfMessage(message)
  return chat ? chatTitle(chat, props.currentUserId) : `#${message.chat_id}`
}

/** Аватар чата (собеседника) для результата поиска. */
const messageChatAvatar = (message: Message): string | undefined => {
  const chat = chatOfMessage(message)
  return chat ? chatAvatarOf(chat) : undefined
}

/** Префикс «Вы: » для своих сообщений в результате поиска. */
const messageSenderPrefix = (message: Message): string =>
  props.currentUserId !== null && message.user_id === props.currentUserId ? 'Вы: ' : ''

/** Текст сниппета сообщения (текст или тип вложения). */
const messageSnippetText = (message: Message): string => {
  if (message.hidden) return 'Скрыто до проверки модератором'
  if (isLockedFile(message)) return lockedFileLabel(message)
  if (message.encrypted && isEncryptedPayload(message.text)) return '🔒 Сообщение'
  if (message.text) return plainMessageText(message.text)
  return message.file ? mediaTypeLabel(message.file) : ''
}

/** Переход к найденному сообщению в его чате. */
const openMessageResult = (message: Message) => {
  closeSearch()
  settingsMenuOpen.value = false
  emit('open-message', message.chat_id, message.id)
}

/** Открытие приватного чата из вкладки «Контакты». */
const openChatWithContact = async (contact: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(contact.id)
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    // Ошибка показывается только на вкладке «Чаты» (как в исходном Messenger).
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

// ---------- Импорт контактов из телефонной книги ----------
const phoneImportOpen = ref(false)
const phoneBusy = ref(false)
const phoneError = ref('')
const manualPhones = ref('')
const phoneMatched = ref<SearchUserResult[] | null>(null)

interface NativePhoneContact {
  name?: string | string[]
  tel?: string[]
}
interface NavigatorWithContacts extends Navigator {
  contacts?: {
    select(props: string[], options: { multiple: boolean }): Promise<NativePhoneContact[]>
  }
}

/** Поддерживает ли браузер системный выбор контактов (Android Chrome/Edge, PWA). */
const phoneContactsSupported = computed<boolean>(() => {
  const nav = navigator as NavigatorWithContacts
  return typeof nav.contacts?.select === 'function'
})

const openPhoneImport = () => {
  phoneImportOpen.value = true
  phoneError.value = ''
  phoneMatched.value = null
  manualPhones.value = ''
}

const closePhoneImport = () => {
  if (phoneBusy.value) return
  phoneImportOpen.value = false
}

const normalizePhone = (raw: string): string => raw.replace(/\D/g, '')

/** Запускает поиск пользователей по номерам. */
const runPhoneMatch = async (phones: string[]) => {
  phoneError.value = ''
  const clean = phones.map(normalizePhone).filter((p) => p.length >= 7)
  if (clean.length === 0) {
    phoneError.value = 'Не удалось определить номера. Проверьте ввод.'
    phoneMatched.value = []
    return
  }
  phoneBusy.value = true
  try {
    phoneMatched.value = await matchUsersByPhone(clean)
  } catch (error) {
    phoneError.value = getErrorMessage(error, 'Не удалось найти в мессенджере')
  } finally {
    phoneBusy.value = false
  }
}

/** Выбор контактов из системной книги. */
const pickDeviceContacts = async () => {
  const nav = navigator as NavigatorWithContacts
  if (!nav.contacts) return
  phoneBusy.value = true
  phoneError.value = ''
  try {
    const contacts = await nav.contacts.select(['tel', 'name'], { multiple: true })
    const phones = contacts.flatMap((c) => c.tel ?? [])
    await runPhoneMatch(phones)
  } catch (error) {
    const err = error as { name?: string }
    // Отмена выбора — не ошибка.
    if (err?.name && err.name !== 'NotAllowedError') {
      phoneError.value = getErrorMessage(error, 'Не удалось открыть контакты')
    }
  } finally {
    phoneBusy.value = false
  }
}

/** Убирает результаты импорта из книги (крестик). */
const clearPhoneMatch = () => {
  phoneMatched.value = null
  phoneError.value = ''
}

/**
 * «Добавить из контактов телефона»: сразу открываем системную книгу,
 * без промежуточного окна. Результаты показываем прямо в списке контактов.
 * Если браузер не умеет открывать книгу (десктоп) — вставка номеров вручную.
 */
const onAddFromPhone = () => {
  phoneError.value = ''
  phoneMatched.value = null
  if (phoneContactsSupported.value) {
    void pickDeviceContacts()
  } else {
    openPhoneImport()
  }
}

/** Поиск по вставленным вручную номерам. */
const findByManualPhones = () => {
  const lines = manualPhones.value.split(/[\n,;]+/)
  void runPhoneMatch(lines)
}

/** Открыть чат с пользователем, найденным по номеру. */
const openPhoneMatch = async (user: SearchUserResult) => {
  phoneImportOpen.value = false
  phoneMatched.value = null
  phoneError.value = ''
  await openChatWithContact(user)
}

// Закрываем «⋯» и глобальный поиск при смене вкладки или выбранного чата извне.
watch([() => props.view, () => props.selectedChatId], () => {
  settingsMenuOpen.value = false
  if (searchOpen.value) closeSearch()
})

let searchTimer: number | null = null
watch([searchQuery, searchMode], ([value, mode]) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  searchError.value = ''
  const query = value.trim()
  if (!query) {
    userResults.value = []
    messageResults.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = window.setTimeout(async () => {
    try {
      if (mode === 'messages') {
        messageResults.value = await searchMessages(query)
        userResults.value = []
      } else {
        userResults.value = await searchUsers(query)
        messageResults.value = []
      }
    } catch (error) {
      searchError.value = getErrorMessage(error, 'Не удалось выполнить поиск')
    } finally {
      searching.value = false
    }
  }, 350)
})

onBeforeUnmount(() => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
})
</script>

<style scoped>
.side-panel {
  width: 100%;
  height: 100%;
  background: var(--ms-surface);
  border-right: 1px solid var(--ms-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

.inline-error {
  color: var(--ms-danger);
  font-size: 12px;
  padding: 6px 14px;
  background: var(--ms-danger-bg);
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
  position: relative;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ---------- Индикатор «в сети» (точка на аватаре личного чата) ---------- */
.avatar-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.avatar-wrap.online::after {
  content: '';
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--ms-accent);
  border: 2px solid var(--ms-surface);
  box-shadow: 0 0 0 1px var(--ms-hairline);
  z-index: 1;
}

/* Индикатор «печатает…» в превью диалога */
.row-sub.typing {
  color: var(--ms-accent);
  font-style: italic;
}

/* ---------- Заголовки панелей ---------- */
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  background: var(--ms-surface);
}

/* Значок приложения в углу шапки: тот же размер, что у аватара профиля. */
.app-mark {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
}

.app-mark img {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  /* Круг гарантирован: clip-path не зависит от overflow у родителя. */
  clip-path: circle(50%);
}

/* Плавная смена разделов нижнего меню. */
.section-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.section-enter-active,
.section-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.section-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.section-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .section-enter-active,
  .section-leave-active {
    transition: none;
  }
}

.panel-header-left,
.panel-header-right {
  display: flex;
  gap: 2px;
}

/* Правая группа иконок прижата к краю: слева — значок приложения и истории. */
.panel-header-right {
  margin-left: auto;
}

/* Кнопка «Профиль»: вместо иконки показываем мини-аватар пользователя. */
.self-profile-btn {
  background: none;
  border: none;
  padding: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.self-profile-btn:hover {
  background: var(--ms-hover, #f2f4f6);
}

.self-avatar {
  width: 34px;
  height: 34px;
  font-size: 0.8rem;
}

.panel-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 7px 12px;
  background: var(--ms-surface-2);
  border-radius: 10px;
}

.search-icon {
  color: var(--ms-muted-3);
  font-size: 0.9rem;
}

.panel-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--ms-text);
}

/* Глобальный поиск (открывается по значку вместо верхнего хидера) */
.search-head {
  margin: 8px 10px 10px;
  padding: 3px 6px;
  gap: 6px;
}

.search-back,
.search-clear {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.search-head .panel-search-input {
  min-width: 0;
}

.search-hit {
  padding: 0 1px;
  border-radius: 4px;
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
  font-weight: 600;
}

.search-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 48px 24px;
  text-align: center;
  color: var(--ms-muted-2, #93a0ab);
}

.search-hint-icon {
  color: var(--ms-icon-3, #c3cdd4);
}

.search-hint p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
}

/* ---------- Списки ---------- */
.section-label {
  padding: 8px 14px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--ms-muted);
  user-select: none;
}

.search-mode-tabs {
  display: flex;
  gap: 6px;
  padding: 2px 14px 8px;
}

.search-mode-tab {
  flex: 1;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-muted, #71808d);
  border-radius: 10px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s;
}

.search-mode-tab:hover {
  background: var(--ms-hover, #f2f4f6);
}

.search-mode-tab.active {
  border-color: var(--ms-accent, #2ea25e);
  color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
}

.msg-result-chat {
  color: var(--ms-accent, #2ea25e);
}

.msg-result-snippet {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub.draft {
  color: var(--ms-accent, #2ea25e);
  font-style: italic;
}

/* Действия над чатом теперь только через режим выделения (удержание). */
.chat-row {
  position: relative;
}

/* Индикатор «чат замьючен» рядом со временем */
.row-muted {
  color: var(--ms-muted, #71808d);
  margin-right: 2px;
  vertical-align: -2px;
}

/* Фильтры списка чатов. */
.chat-filters {
  display: flex;
  gap: 5px;
  padding: 8px 12px 4px;
  overflow-x: auto;
  scrollbar-width: none;
  /* Затухание у правого края: подсказка, что ряд фильтров можно прокрутить
     (на узких экранах чипы не влезают целиком). Ширина затухания — в пределах
     бокового отступа, поэтому влезающий ряд не подтемняется. */
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.chat-filters::-webkit-scrollbar {
  display: none;
}

.chat-filter {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: none;
  border-radius: 11px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.chat-filter.active {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
  font-weight: 600;
}

.chat-filter-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 10.5px;
  font-weight: 600;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 6px;
}

/* Обёртка раскрытой полосы историй: «опускается» из-под шапки. */
.stories-collapse {
  overflow: hidden;
}

.stories-drop-enter-active,
.stories-drop-leave-active {
  overflow: hidden;
  transition:
    max-height 0.24s ease,
    opacity 0.18s ease,
    transform 0.24s ease;
}

.stories-drop-enter-from,
.stories-drop-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-10px);
}

.stories-drop-enter-to,
.stories-drop-leave-from {
  max-height: 360px;
}

/* Поиск раскрывается на месте шапки, а не появляется рывком (как в Telegram). */
.search-expand-enter-active,
.search-expand-leave-active {
  overflow: hidden;
  transition:
    max-height 0.2s ease,
    opacity 0.14s ease,
    transform 0.2s ease;
}

.search-expand-enter-from,
.search-expand-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-8px);
}

.search-expand-enter-to,
.search-expand-leave-from {
  max-height: 64px;
}

.row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  /* Длинный список (сотни чатов и контактов): строки за экраном браузер не
     раскладывает. За границы строки здесь ничего не вылезает — меню списка
     живёт в шапке, диалоги телепортируются, — поэтому сдерживание безопасно
     (те же грабли, что с лентой: см. docs/feed-performance.md). */
  content-visibility: auto;
  contain-intrinsic-size: auto 320px auto 76px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

/* Строка контакта: тап по строке открывает чат, а кнопка справа заводит имя. */
.contact-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
}

.contact-row .row-item {
  flex: 1;
  min-width: 0;
}

.contact-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-muted-3);
  cursor: pointer;
}

.contact-action:hover {
  background: var(--ms-hover);
}

.cn-side-error {
  margin: 0;
  padding: 10px 14px;
  color: var(--ms-danger);
  font-size: 12.5px;
}

.row-item:hover {
  background: var(--ms-hover);
}

.row-item.active {
  background: var(--ms-accent-soft);
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-title {
  font-size: calc(15px * var(--ms-text-scale, 1));
  font-weight: 600;
  color: var(--ms-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Метка канала («рупор») перед названием в списке чатов. */
.row-channel {
  margin-right: 5px;
  color: var(--ms-muted-2);
  vertical-align: -2px;
}

.row-time {
  font-size: 12px;
  color: var(--ms-muted-2);
  flex-shrink: 0;
}

.row-sub {
  font-size: calc(13.5px * var(--ms-text-scale, 1));
  color: var(--ms-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub.preview {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tick {
  font-size: 0.85rem;
  color: var(--ms-tick);
  flex-shrink: 0;
}

.unread-badge {
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 11px;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  flex-shrink: 0;
}

.row-arrow {
  color: var(--ms-icon-3);
  font-size: 0.95rem;
}

.people-results {
  border-bottom: 1px solid var(--ms-border);
}

.search-status,
.empty-hint {
  padding: 14px;
  color: var(--ms-muted-2);
  font-size: 13.5px;
  text-align: center;
}

/* Dropdown-меню «⋯» */
.ms-dropdown-wrap {
  position: relative;
  display: inline-flex;
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  box-shadow: var(--ms-shadow-pop);
  padding: 6px;
  z-index: 120;
  display: flex;
  flex-direction: column;
}

.ms-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  font-family: inherit;
  color: var(--ms-text);
  white-space: nowrap;
}

.ms-dropdown-item:hover {
  background: var(--ms-hover);
}

.ms-dropdown-item i {
  width: 18px;
  text-align: center;
  font-size: 1rem;
  color: var(--ms-icon-2);
}

.ms-dropdown-item .q-icon {
  width: 18px;
  text-align: center;
  color: var(--ms-icon-2);
}

/* Нижний отступ до «плавающей» панели разделов (safe-area учтён в ней). */
.chat-scroll {
  padding-bottom: 8px;
}

/* ---------- Режим выделения чатов (вход по удержанию) ---------- */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.selection-count {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selection-actions .icon-btn.danger {
  color: var(--ms-danger, #d64545);
}

/* Кружок-чекбокс слева в строке чата при выделении. */
.row-selector {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 2px solid var(--ms-muted, #93a0ab);
  border-radius: 50%;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-on-accent);
}

.row-selector.on {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
}

.row-item.selected {
  background: var(--ms-accent-soft, #e3f2e5);
}

/* ---------- Импорт контактов телефона ---------- */
.phone-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: var(--ms-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: var(--ms-font);
}

.phone-card {
  width: min(440px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border-radius: 18px;
  box-shadow: var(--ms-shadow-pop);
  overflow: hidden;
}

.phone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
}

.phone-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ms-text-strong, #141d26);
}

.phone-title .q-icon {
  color: var(--ms-accent, #2ea25e);
}

.phone-xbtn {
  background: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-icon, #52626f);
  cursor: pointer;
}

.phone-xbtn:hover {
  background: var(--ms-hover, #f2f4f6);
  color: var(--ms-text-strong, #141d26);
}

.phone-body {
  padding: 8px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.phone-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.phone-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.phone-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.phone-or {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  color: var(--ms-muted, #93a0ab);
  font-size: 12px;
}

.phone-or::before,
.phone-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ms-border, #e2e6ea);
}

.phone-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
  margin-bottom: 5px;
}

.phone-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
}

.phone-textarea:focus {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-surface, #ffffff);
}

.phone-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.phone-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.phone-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.phone-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.phone-btn.primary {
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.phone-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}

.phone-result-title {
  margin: 14px 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

.phone-empty {
  padding: 12px 4px;
  font-size: 13.5px;
  color: var(--ms-muted, #71808d);
}

.phone-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.phone-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 12px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}

.phone-row:hover {
  background: var(--ms-hover, #f2f4f6);
}

.phone-row .avatar {
  width: 40px;
  height: 40px;
}

.phone-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.phone-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-phone {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-icon {
  color: var(--ms-accent, #2ea25e);
  flex: none;
}

/* Встроенные результаты импорта из телефонной книги (без промежуточного окна) */
.phone-inline {
  padding: 4px 12px 6px;
  border-top: 1px solid var(--ms-border, #eef1f3);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.phone-inline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 2px 2px;
}

.phone-inline-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: var(--ms-muted, #71808d);
  cursor: pointer;
}

.phone-inline-clear:hover {
  background: var(--ms-hover, #eef1f4);
}

.phone-inline-list {
  overflow-y: auto;
  max-height: 34vh;
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.phone-inline .row-item {
  border-radius: 10px;
}

.phone-inline .phone-result-title {
  margin: 0;
}
/* ---------- Нижняя навигация (чаты / истории / контакты) ---------- */
/* «Плавающая» панель разделов: отступ от краёв экрана, радиус, рамка и мягкая
   тень. Тон панели отличается от полотна, рамка полноцветная (не полупрозрачная),
   тень даёт «подъём» — иначе панель выглядит бледной и непонятно, где границы. */
.bottom-nav {
  display: flex;
  align-items: stretch;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface-2);
  box-shadow: var(--ms-shadow-float);
  overflow: hidden;
}

.bottom-nav-btn {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 0 8px;
  border: none;
  background: transparent;
  color: var(--ms-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  cursor: pointer;
  transition: color 0.16s ease;
}

/* Активная вкладка — только цветом: фон/подложка здесь лишние. */
.bottom-nav-btn.active {
  color: var(--ms-accent);
  font-weight: 600;
}

.bottom-nav-btn:hover {
  color: var(--ms-text-strong, var(--ms-text));
}

.bottom-nav-btn.active:hover {
  color: var(--ms-accent);
}

/* Точка «есть новое»: прижата к «пилюле» иконки, а не к краю кнопки. */
.bottom-nav-badge {
  position: absolute;
  top: 3px;
  right: calc(50% - 26px);
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 19px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--ms-surface-2);
}

.bottom-nav-dot {
  position: absolute;
  top: 5px;
  right: calc(50% - 17px);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ms-accent);
  box-shadow: 0 0 0 2px var(--ms-surface);
}

@media (max-width: 380px) {
  .bottom-nav-btn {
    font-size: 10.5px;
    padding: 6px 0 7px;
  }
}
</style>
