<template>
  <Teleport to="body">
    <transition name="call-fade">
      <!-- Полноэкранный звонок -->
      <div
        v-if="callStore.status !== 'idle'"
        class="call-overlay"
        @mousedown.stop
        @pointerdown="onOverlayPointerDown"
      >
        <template v-if="callStore.status === 'incoming'">
          <div class="call-card">
            <span class="call-avatar" :style="avatarStyle(displayName)">
              <img
                v-if="avatarUrl && !avatarImgFailed"
                :src="avatarUrl"
                class="avatar-img"
                alt=""
                @error="avatarImgFailed = true"
              />
              <template v-else>{{ displayNameInitials }}</template>
            </span>
            <h2 class="call-name">{{ displayName }}</h2>
            <p class="call-subtitle">
              Входящий {{ callStore.kind === 'video' ? 'видеозвонок' : 'звонок' }}
            </p>
            <div class="call-controls incoming-controls">
              <button class="ctl-btn danger big" title="Отклонить" @click="callStore.declineCall()">
                <q-icon :name="icon('call_end')" size="28px" />
              </button>
              <button class="ctl-btn accept big" title="Ответить" @click="callStore.acceptCall()">
                <q-icon
                  :name="icon(callStore.kind === 'video' ? 'videocam' : 'call')"
                  size="28px"
                />
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="callStore.status === 'outgoing'">
          <!-- Групповой вызов: я уже «в звонке» — вижу себя, а у остальных идёт
               вызов. Ждать, пока поднимут все трубки, не нужно: как только
               ответит первый, разговор начнётся, остальные присоединятся. -->
          <template v-if="callStore.isGroup">
            <div class="group-stage">
              <!-- Та же верхняя строка, что и в разговоре: подпись слева,
                   кнопка отмены справа. Плитки ниже — их кнопки сброса видны. -->
              <div class="group-ringing">
                <p class="call-subtitle">Звоним…</p>
                <button class="ctl-btn danger big" title="Отменить" @click="callStore.cancelCall()">
                  <q-icon :name="icon('call_end')" size="28px" />
                </button>
              </div>
              <CallGrid @drop="callStore.dropPeer" />
            </div>
          </template>
          <div v-else class="call-card">
            <span class="call-avatar" :style="avatarStyle(displayName)">
              <img
                v-if="avatarUrl && !avatarImgFailed"
                :src="avatarUrl"
                class="avatar-img"
                alt=""
                @error="avatarImgFailed = true"
              />
              <template v-else>{{ displayNameInitials }}</template>
            </span>
            <h2 class="call-name">{{ displayName }}</h2>
            <p class="call-subtitle">Звоним…</p>
            <div class="call-controls incoming-controls">
              <button class="ctl-btn danger big" title="Отменить" @click="callStore.cancelCall()">
                <q-icon :name="icon('call_end')" size="28px" />
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="callStore.status === 'active'">
          <!-- Групповой звонок «mesh»: видео и звук идут от каждого участника
               напрямую, поэтому показываем сетку плиток, а не одного человека.
               Сетка живёт внутри общего слоя вместе с плашкой и кнопками: в
               групповом звонке это три строки друг под другом — плашка и кнопки
               не ложатся на плитки и не закрывают их кнопки. -->
          <!-- Удалённый поток — РОВНО ОДИН элемент, и он ВСЕГДА в разметке.
               Элемент нужен не только картинке: только привязанный к элементу
               поток Chrome отдаёт в Web Audio (проверено живьём 18.09.2026 —
               без элемента звук не доходит вовсе, и мы его не измеряем).
               Поэтому в аудио-звонке элемент остаётся (невидимым), а когда
               камера собеседника выключена — на месте картинки аватар. -->
          <video
            v-if="!callStore.isGroup"
            ref="remoteVideoEl"
            class="remote-video"
            :class="{ 'remote-hidden': !remoteVideoVisible }"
            autoplay
            playsinline
          ></video>
          <!-- Камера собеседника выключена: аватар вместо чёрного прямоугольника.
               В аудио-звонке этот блок не нужен — там аватар рисует `.active-ui`. -->
          <div
            v-if="!callStore.isGroup && callStore.kind === 'video' && !remoteVideoVisible"
            class="peer-video-off"
          >
            <span class="call-avatar huge" :style="avatarStyle(displayName)">
              <img
                v-if="avatarUrl && !avatarImgFailed"
                :src="avatarUrl"
                class="avatar-img"
                alt=""
                @error="avatarImgFailed = true"
              />
              <template v-else>{{ displayNameInitials }}</template>
            </span>
            <!-- В аудиозвонке это норма, подпись нужна только видеозвонку. -->
            <p class="peer-video-off-text">Камера собеседника выключена</p>
          </div>

          <div
            class="active-ui"
            :class="{ audio: callStore.kind === 'audio', group: callStore.isGroup }"
          >
            <!-- Аудио-режим: аватар поверх фона -->
            <template v-if="callStore.kind === 'audio'">
              <span class="call-avatar huge" :style="avatarStyle(displayName)">
                <img
                  v-if="avatarUrl && !avatarImgFailed"
                  :src="avatarUrl"
                  class="avatar-img"
                  alt=""
                  @error="avatarImgFailed = true"
                />
                <template v-else>{{ displayNameInitials }}</template>
              </span>
              <h2 class="call-name audio-name">{{ displayName }}</h2>
              <p class="call-subtitle audio-sub">
                Голосовой звонок · <span class="call-timer">{{ callStore.formattedTime }}</span>
              </p>
              <div v-if="hasCallBadges" class="call-badges">
                <span
                  v-if="!callStore.peerMicOn"
                  class="call-badge"
                  title="Собеседник выключил микрофон"
                >
                  <q-icon :name="icon('mic_off')" size="12px" aria-hidden="true" />
                  Микрофон собеседника выключен
                </span>
                <span
                  v-if="callStore.connectionQuality !== 'good'"
                  class="call-badge"
                  :class="callStore.connectionQuality"
                  :title="callStore.diagnosticsSummary"
                >
                  <q-icon :name="icon('wifi_off')" size="12px" aria-hidden="true" />
                  Плохая связь
                </span>
                <span
                  v-if="callStore.videoPausedForNetwork"
                  class="call-badge fair"
                  title="Связь слабая — видео приостановлено, чтобы не пропадал звук"
                >
                  <q-icon :name="icon('videocam_off')" size="12px" aria-hidden="true" />
                  Видео приостановлено
                </span>
                <!-- Свой показ экрана видно и словами: раньше о нём говорила
                     только подсвеченная кнопка, и было непонятно, идёт ли он. -->
                <span v-if="callStore.screenSharing" class="call-badge share">
                  <q-icon :name="icon('screen_share')" size="12px" aria-hidden="true" />
                  Вы показываете экран
                </span>
              </div>
              <span v-if="callStore.peerScreenSharing" class="call-sharing">
                <q-icon :name="icon('screen_share')" size="13px" aria-hidden="true" />
                Собеседник показывает экран
              </span>
              <span class="call-e2ee" :title="callStore.callRouteHint">
                <q-icon :name="icon('lock')" size="11px" aria-hidden="true" />
                {{ callStore.callRouteLabel }}
              </span>
            </template>

            <!-- Видео-режим: HUD сверху -->
            <div v-else class="video-hud">
              <span class="hud-avatar" :style="avatarStyle(displayName)">
                <img
                  v-if="avatarUrl && !avatarImgFailed"
                  :src="avatarUrl"
                  class="avatar-img"
                  alt=""
                  @error="avatarImgFailed = true"
                />
                <template v-else>{{ displayNameInitials }}</template>
              </span>
              <div class="hud-info">
                <div class="hud-name">{{ displayName }}</div>
                <div class="hud-time">{{ callStore.formattedTime }}</div>
                <div v-if="hasCallBadges" class="call-badges">
                  <span
                    v-if="!callStore.peerMicOn"
                    class="call-badge"
                    title="Собеседник выключил микрофон"
                  >
                    <q-icon :name="icon('mic_off')" size="12px" aria-hidden="true" />
                    Микрофон выключен
                  </span>
                  <span
                    v-if="callStore.connectionQuality !== 'good'"
                    class="call-badge"
                    :class="callStore.connectionQuality"
                    :title="callStore.diagnosticsSummary"
                  >
                    <q-icon :name="icon('wifi_off')" size="12px" aria-hidden="true" />
                    Плохая связь
                  </span>
                  <span
                    v-if="callStore.videoPausedForNetwork"
                    class="call-badge fair"
                    title="Связь слабая — видео приостановлено (верните в меню «Ещё»)"
                  >
                    <q-icon :name="icon('videocam_off')" size="12px" aria-hidden="true" />
                    Видео приостановлено
                  </span>
                  <span v-if="callStore.screenSharing" class="call-badge share">
                    <q-icon :name="icon('screen_share')" size="12px" aria-hidden="true" />
                    Вы показываете экран
                  </span>
                </div>
                <span v-if="callStore.peerScreenSharing" class="call-sharing video">
                  <q-icon :name="icon('screen_share')" size="12px" aria-hidden="true" />
                  Собеседник показывает экран
                </span>
                <span class="call-e2ee video" :title="callStore.callRouteHint">
                  <q-icon :name="icon('lock')" size="10px" aria-hidden="true" />
                  {{ callStore.callRouteLabel }}
                </span>
              </div>
            </div>

            <!-- Групповой звонок: сетка плиток — своя строка между плашкой и
                 кнопками. -->
            <CallGrid v-if="callStore.isGroup" @drop="callStore.dropPeer" />

            <!-- Локальное превью (видео). Если выбрана маска — потяните её по
                 лицу: положение считается по кадру, а не по элементу, поэтому
                 маска не уезжает от пальца при обрезке (`cover`) и зеркале. -->
            <video
              v-if="callStore.kind === 'video'"
              ref="localVideoEl"
              class="local-video"
              :class="{ mirrored: mirrorLocal, 'mask-drag': callStore.videoMask !== null }"
              autoplay
              playsinline
              muted
              @pointerdown="onMaskPointerDown"
              @pointermove="onMaskPointerMove"
              @pointerup="onMaskPointerUp"
              @pointercancel="onMaskPointerUp"
            ></video>

            <!-- Элементы управления: в панели — только частое (микрофон, камера,
                 завершить). Остальное — в меню «ещё»: иначе на телефоне кнопки
                 не помещаются в одну строку. -->
            <div class="call-controls active-controls">
              <button
                class="ctl-btn"
                :class="{ off: !callStore.micOn }"
                title="Микрофон"
                @click="callStore.toggleMic()"
              >
                <q-icon :name="icon('mic')" size="26px" />
              </button>
              <button
                v-if="callStore.kind === 'video' && !callStore.screenSharing"
                class="ctl-btn"
                :class="{ off: !callStore.videoOn }"
                title="Камера"
                @click="callStore.toggleCamera()"
              >
                <q-icon :name="icon('videocam')" size="26px" />
              </button>
              <!-- Показ экрана — в самой панели: раньше он жил только в меню
                   «Ещё», и владелец решил, что показ пропал («его нет уже
                   давно»). На телефоне кнопки не будет вовсе: там
                   `getDisplayMedia` нет, и место в панели тратить не на что. -->
              <button
                v-if="canShareScreen || callStore.screenSharing"
                class="ctl-btn"
                :class="{ 'screen-on': callStore.screenSharing }"
                :title="callStore.screenSharing ? 'Остановить показ экрана' : 'Показать экран'"
                :aria-pressed="callStore.screenSharing"
                @click="callStore.toggleScreenShare()"
              >
                <q-icon
                  :name="icon(callStore.screenSharing ? 'stop_screen_share' : 'screen_share')"
                  size="26px"
                />
              </button>
              <button
                ref="moreBtnEl"
                class="ctl-btn"
                :class="{ 'screen-on': callStore.screenSharing, 'speaker-on': moreOpen }"
                :title="moreOpen ? 'Скрыть меню' : 'Ещё'"
                :aria-expanded="moreOpen"
                :aria-pressed="moreOpen"
                @click="toggleMore"
              >
                <q-icon :name="icon(moreOpen ? 'close' : 'more_vert')" size="26px" />
              </button>
              <button class="ctl-btn danger big" title="Завершить" @click="callStore.endCall()">
                <q-icon :name="icon('call_end')" size="28px" />
              </button>
            </div>

            <!-- Меню «ещё» и панели (устройства, диагностика) — один слой поповеров:
                 тап мимо любой из них закрывает всё (см. onOverlayPointerDown). -->
            <div ref="popoversEl" class="call-popovers">
              <!-- Меню «ещё»: редкие во время звонка действия -->
              <div v-if="moreOpen" class="call-more" role="menu">
                <button class="more-row" role="menuitem" @click="onSpeakerRow">
                  <q-icon :name="icon(speakerOn ? 'volume_up' : 'volume_down')" size="20px" />
                  <span>{{ speakerOn ? 'Обычный режим' : 'Громкая связь' }}</span>
                  <q-icon v-if="speakerOn" :name="icon('check')" size="16px" class="more-mark" />
                </button>
                <!-- Видео могло «встать» само из-за плохой связи: возврат — решением человека. -->
                <button
                  v-if="callStore.videoPausedForNetwork"
                  class="more-row"
                  role="menuitem"
                  @click="onResumeVideoRow"
                >
                  <q-icon :name="icon('videocam')" size="20px" />
                  <span>Вернуть видео</span>
                </button>
                <button
                  v-if="canShareScreen || callStore.screenSharing"
                  class="more-row"
                  :class="{ on: callStore.screenSharing }"
                  role="menuitem"
                  @click="onScreenRow"
                >
                  <q-icon
                    :name="icon(callStore.screenSharing ? 'stop_screen_share' : 'screen_share')"
                    size="20px"
                  />
                  <span>{{
                    callStore.screenSharing ? 'Остановить показ экрана' : 'Показать экран'
                  }}</span>
                  <q-icon
                    v-if="callStore.screenSharing"
                    :name="icon('check')"
                    size="16px"
                    class="more-mark"
                  />
                </button>
                <!-- Показа нет — говорим почему (телефон, http, браузер): без
                     этой строки пункт просто исчезает, и это выглядит поломкой. -->
                <p v-else-if="shareNotice" class="more-note">{{ shareNotice }}</p>
                <!-- Камера в видеозвонке: передняя нужна для разговора, задняя —
                     чтобы показать что-то вокруг (телефон). -->
                <button
                  v-if="callStore.kind === 'video' && !callStore.screenSharing && canSwitchCamera"
                  class="more-row"
                  :class="{ on: callStore.cameraFacing === 'environment' }"
                  role="menuitem"
                  @click="onSwitchCameraRow"
                >
                  <q-icon :name="icon('switch_camera')" size="20px" />
                  <span>{{
                    callStore.cameraFacing === 'environment' ? 'Передняя камера' : 'Задняя камера'
                  }}</span>
                  <q-icon
                    v-if="callStore.cameraFacing === 'environment'"
                    :name="icon('check')"
                    size="16px"
                    class="more-mark"
                  />
                </button>
                <button
                  class="more-row"
                  :class="{ on: settingsOpen }"
                  role="menuitem"
                  @click="onDevicesRow"
                >
                  <q-icon :name="icon('tune')" size="20px" />
                  <span>Устройства звонка</span>
                  <q-icon v-if="settingsOpen" :name="icon('check')" size="16px" class="more-mark" />
                </button>
                <!-- Эффекты видео: цвет кадра и маска. Показ экрана их выключает
                     (эффект — про камеру), поэтому пункт в этот момент не нужен. -->
                <button
                  v-if="callStore.kind === 'video' && !callStore.screenSharing"
                  class="more-row"
                  :class="{ on: effectsOpen }"
                  role="menuitem"
                  @click="onEffectsRow"
                >
                  <q-icon :name="icon('palette')" size="20px" />
                  <span>Эффекты видео</span>
                  <q-icon v-if="effectsOpen" :name="icon('check')" size="16px" class="more-mark" />
                </button>
                <!-- Картинка в картинке: разговор можно свернуть в плавающее окно
                   и заниматься другим (видеозвонок или показ экрана). -->
                <button
                  v-if="canPictureInPicture"
                  class="more-row"
                  role="menuitem"
                  @click="onPictureInPictureRow"
                >
                  <q-icon :name="icon('picture_in_picture')" size="20px" />
                  <span>Окно поверх других</span>
                </button>
                <!-- Диагностика: куда идёт медиа (напрямую/через релей) и как оно
                   себя чувствует. Нужна, когда «нет звука» или «чёрный экран». -->
                <button
                  class="more-row"
                  :class="{ on: diagnosticsOpen }"
                  role="menuitem"
                  @click="onDiagnosticsRow"
                >
                  <q-icon :name="icon('wifi')" size="20px" />
                  <span>Диагностика звонка</span>
                  <q-icon
                    v-if="diagnosticsOpen"
                    :name="icon('check')"
                    size="16px"
                    class="more-mark"
                  />
                </button>
                <!-- Код сверки: сервер ведёт сигналинг, поэтому теоретически мог бы
                   свести с третьим участником. Код считается из сертификатов
                   обеих сторон — сравнив его вслух, это можно исключить. -->
                <button
                  class="more-row"
                  :class="{ on: verifyOpen }"
                  role="menuitem"
                  @click="onVerifyRow"
                >
                  <q-icon :name="icon('verified_user')" size="20px" />
                  <span>Код сверки</span>
                  <q-icon v-if="verifyOpen" :name="icon('check')" size="16px" class="more-mark" />
                </button>
              </div>

              <!-- Панель кода сверки: те же 6 цифр у обоих участников. -->
              <div v-if="verifyOpen" class="call-verify">
                <p v-if="!callStore.verificationCode" class="diagnostics-hint">
                  Код появится, когда соединение установится.
                </p>
                <template v-else>
                  <div class="verify-code" aria-label="Код сверки">
                    {{ formatVerificationCode(callStore.verificationCode) }}
                  </div>
                </template>
                <p class="verify-hint">
                  Сравните код с собеседником вслух — по телефону или голосом. Совпал — разговор
                  идёт именно между вами, сервер в середине отсутствует. Код меняется у каждого
                  нового звонка: сверять надо каждый раз.
                </p>
              </div>

              <!-- Панель диагностики соединения -->
              <div v-if="diagnosticsOpen" class="call-diagnostics">
                <p v-if="!callStore.diagnostics" class="diagnostics-hint">
                  Собираем данные о соединении…
                </p>
                <template v-else>
                  <div v-for="row in diagRows" :key="row.label" class="diag-row">
                    <span class="diag-label">{{ row.label }}</span>
                    <span class="diag-value">{{ row.value }}</span>
                  </div>
                </template>
                <!-- Групповой звонок: связь с КАЖДЫМ участником — панель отвечает
                     на вопрос «кто именно меня не слышит». -->
                <div v-for="row in peerDiagRows" :key="`peer-${row.label}`" class="diag-row">
                  <span class="diag-label">{{ row.label }}</span>
                  <span class="diag-value">{{ row.value }}</span>
                </div>
                <div class="diag-actions">
                  <button class="diag-btn" @click="copyDiagnostics">
                    <q-icon
                      :name="icon(copiedDiagnostics ? 'check' : 'content_copy')"
                      size="14px"
                    />
                    {{ copiedDiagnostics ? 'Скопировано' : 'Скопировать' }}
                  </button>
                  <button class="diag-btn" @click="callStore.refreshDiagnostics()">
                    <q-icon :name="icon('refresh')" size="14px" />
                    Обновить
                  </button>
                </div>
              </div>

              <!-- Настройки устройств звонка. Списки — свои (SelectField), а не
                   родные <select>: системное окно браузера открывается далеко от
                   поля (жалоба 15.09.2026). -->
              <div v-if="settingsOpen" class="call-settings">
                <div v-if="callStore.cameras.length" class="settings-row">
                  <span class="settings-label">Камера</span>
                  <SelectField
                    :model-value="callStore.selectedCamera"
                    :options="cameraOptions"
                    variant="call"
                    aria-label="Камера"
                    @update:model-value="onCameraPick"
                  />
                </div>

                <div v-if="callStore.microphones.length" class="settings-row">
                  <span class="settings-label">Микрофон</span>
                  <SelectField
                    :model-value="callStore.selectedMic"
                    :options="micOptions"
                    variant="call"
                    aria-label="Микрофон"
                    @update:model-value="onMicPick"
                  />
                </div>

                <!-- Шумодав на части телефонов делает голос «роботом»: даём выбор. -->
                <div class="settings-row">
                  <span class="settings-label">Обработка звука</span>
                  <SelectField
                    :model-value="callStore.micProcessing"
                    :options="micModeOptions"
                    variant="call"
                    aria-label="Обработка звука"
                    @update:model-value="onMicModePick"
                  />
                </div>

                <div v-if="callStore.speakers.length && canSelectSpeaker" class="settings-row">
                  <span class="settings-label">Звук</span>
                  <SelectField
                    :model-value="callStore.selectedSpeaker"
                    :options="speakerOptions"
                    variant="call"
                    aria-label="Звук"
                    @update:model-value="onSpeakerPick"
                  />
                </div>

                <p
                  v-if="!callStore.cameras.length && !callStore.microphones.length"
                  class="settings-hint"
                >
                  Список устройств появится после разрешения доступа к камере и микрофону.
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </transition>

    <!-- Тост-уведомление о завершении/ошибке -->
    <transition name="call-fade">
      <!-- Смена сети: показываем, что звонок восстанавливается, а не «завис».
           Обёртка обязательна: у <transition> может быть только один корневой
           узел, а плашек две (переподключение и тост-уведомление) — с двумя
           детьми шаблон вообще не компилируется. -->
      <div v-if="callStore.reconnecting || noticeVisible" class="call-floats">
        <div v-if="callStore.reconnecting" class="call-reconnect">
          <span class="call-reconnect-spinner" aria-hidden="true"></span>
          Переподключаемся…
        </div>

        <div v-if="noticeVisible" class="call-notice" @click="hideNotice">
          {{ callStore.notice }}
        </div>
      </div>
    </transition>

    <!-- Окно эффектов видео (цвет кадра и маска) — поверх звонка. -->
    <CallEffectsDialog v-if="effectsOpen" @close="effectsOpen = false" />
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { peerQualityLine, screenShareNotice, screenShareSupport, useCallStore } from '@/stores/call'
import { mediaUrl } from '@/services/chatService'
import CallGrid from '@/components/calls/CallGrid.vue'
import CallEffectsDialog from '@/components/calls/CallEffectsDialog.vue'
import { framePointFromPointer } from '@/utils/videoEffects'
import SelectField from '@/components/common/SelectField.vue'
import type { SelectValue } from '@/utils/select'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'
import { formatVerificationCode } from '@/utils/callVerification'

const callStore = useCallStore()

const remoteVideoEl = ref<HTMLVideoElement | null>(null)
const localVideoEl = ref<HTMLVideoElement | null>(null)
/** Доступен ли в этом окружении захват экрана (иначе пункт меню скрыт). */
const canShareScreen = screenShareSupport() === 'ok'
/** Почему показа экрана нет — покажем в меню, чтобы это не выглядело поломкой. */
const shareNotice = canShareScreen ? '' : screenShareNotice(screenShareSupport())
/** Есть ли из чего выбирать камеру: на телефоне их обычно две (передняя/задняя). */
const canSwitchCamera = computed(() => callStore.cameras.length > 1)
/**
 * Зеркалить ли своё превью.
 *
 * Зеркалим ТОЛЬКО переднюю камеру: так человек видит себя как в зеркале. Задняя
 * камера и показ экрана зеркальными быть не должны — там текст читался бы
 * справа налево (раньше превью зеркалилось всегда, и показ экрана тоже).
 */
const mirrorLocal = computed(() => !callStore.screenSharing && callStore.cameraFacing === 'user')

const noticeVisible = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let attachTimer: ReturnType<typeof setInterval> | undefined

/** Видно ли картинку собеседника (иначе элемент невидим, но звук остаётся). */
const remoteVideoVisible = computed<boolean>(
  () => callStore.kind === 'video' && callStore.peerVideoOn
)

/** Есть ли у собеседника видеодорожка (нужно, чтобы переписать элемент при её появлении). */
const remoteVideoTracks = ref(0)
/** Показаны ли бейджи «микрофон выключен» / «плохая связь» / «видео приостановлено». */
const hasCallBadges = computed(
  () =>
    !callStore.peerMicOn ||
    callStore.connectionQuality !== 'good' ||
    callStore.videoPausedForNetwork ||
    callStore.screenSharing
)

/** Открыта ли панель «Диагностика звонка». */
const diagnosticsOpen = ref(false)
/** Открыта ли панель «Код сверки». */
const verifyOpen = ref(false)
const copiedDiagnostics = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

/** Куда идёт медиа: напрямую, через NAT или через наш релей. */
const routeLabel = computed<string>(() => {
  const diag = callStore.diagnostics
  if (!diag) return '—'
  if (diag.candidateType === 'relay') {
    return `через релей (TURN${diag.relayProtocol ? `, ${diag.relayProtocol}` : ''})`
  }
  if (diag.candidateType === 'srflx' || diag.candidateType === 'prflx') {
    return 'напрямую через NAT'
  }
  if (diag.candidateType === 'host') return 'напрямую'
  return 'определяем…'
})

/** Что ограничивает отправку — понятными словами (см. `utils/callStats.ts`). */
const limitationLabel = (value: string): string => {
  if (value === 'bandwidth') return 'полоса'
  if (value === 'cpu') return 'процессор'
  if (value === 'other') return 'прочее'
  return '—'
}

/** Строки панели диагностики — то, что полезно при разборе «нет звука». */
const diagRows = computed<Array<{ label: string; value: string }>>(() => {
  const diag = callStore.diagnostics
  if (!diag) return []
  return [
    { label: 'Соединение', value: `ICE: ${diag.iceState} · ${diag.connectionState}` },
    { label: 'Маршрут', value: routeLabel.value },
    { label: 'Задержка', value: `${diag.rttMs} мс` },
    { label: 'Потери', value: `${diag.lossPercent}%` },
    // Потери нашего потока у собеседника: на мобильной сети страдает именно отправка.
    { label: 'Потери у собеседника', value: `${diag.remoteLossPercent}%` },
    { label: 'Дрожание', value: `${diag.jitterMs} мс` },
    { label: 'Буфер воспроизведения', value: `${diag.jitterBufferDelayMs} мс` },
    { label: 'Приём', value: `${diag.inboundKbps} кбит/с` },
    { label: 'Отправка', value: `${diag.outboundKbps} кбит/с` },
    {
      label: 'Полоса (оценка)',
      value: diag.availableOutgoingKbps > 0 ? `${diag.availableOutgoingKbps} кбит/с` : '—'
    },
    { label: 'Ограничивает', value: limitationLabel(diag.qualityLimitation) },
    {
      label: 'Видео теряется',
      value: `${diag.freezeCount} заморозок · ${diag.framesDropped} кадров`
    },
    { label: 'Кодеки', value: diag.codecs.join(', ') || '—' }
  ]
})

/**
 * Строки по каждому участнику — только в групповом звонке.
 *
 * В 1:1 это те же цифры, что и выше; в группе «плохо слышно» относится к
 * конкретному собеседнику, поэтому показываем связь с каждым: панель отвечает
 * на вопрос «кто именно меня не слышит».
 */
const peerDiagRows = computed<Array<{ label: string; value: string }>>(() => {
  if (!callStore.isGroup) return []
  return callStore.participants.map((participant) => ({
    label: participant.name,
    value: peerQualityLine(callStore.peerDiagnostics[participant.id] ?? null)
  }))
})

/** Текст отчёта для копирования в поддержку/чат. */
const diagnosticsText = computed<string>(() =>
  [
    `Звонок: ${callStore.kind === 'video' ? 'видео' : 'аудио'}, ${callStore.formattedTime}`,
    ...diagRows.value.map((row) => `${row.label}: ${row.value}`),
    // В группе — по строке на участника: «плохо слышно» относится к конкретному.
    ...peerDiagRows.value.map((row) => `Участник ${row.label}: ${row.value}`),
    `Итого: ${callStore.diagnosticsSummary}`
  ].join('\n')
)

const copyDiagnostics = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(diagnosticsText.value)
    copiedDiagnostics.value = true
    if (copyTimer !== undefined) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copiedDiagnostics.value = false
      copyTimer = undefined
    }, 2000)
  } catch {
    /* нет доступа к буферу — не страшно, данные видны на экране */
  }
}

// «Громкая связь»: по умолчанию тихо («к уху»), кнопкой — на максимум.
// Громкость задаём через Web Audio gain в call.ts — element.volume на
// телефонах игнорируется, поэтому без этого «тихий» режим не работал бы.
const EARP_VOLUME = 0.12
const speakerOn = ref(false)

// Панель выбора устройств (камера/микрофон/динамик) во время звонка.
const settingsOpen = ref(false)

// Окно эффектов видео (цвет кадра и маска) — отдельным слоем поверх звонка.
const effectsOpen = ref(false)

// Меню «ещё»: редкие во время звонка действия (громкая связь, показ экрана,
// устройства). В панели они не помещаются на телефоне в одну строку.
const moreOpen = ref(false)

// Слой поповеров (меню и панели) и кнопка «Ещё»: нужны, чтобы по тапу МИМО
// закрывать открытое, а тап по самой кнопке продолжал переключать меню.
const popoversEl = ref<HTMLElement | null>(null)
const moreBtnEl = ref<HTMLElement | null>(null)

/** Закрыть всё открытое поверх звонка (меню, устройства, диагностика, код). */
const closePanels = () => {
  moreOpen.value = false
  settingsOpen.value = false
  diagnosticsOpen.value = false
  verifyOpen.value = false
}
/**
 * Нажатие в любом месте звонка.
 *
 * Заодно закрываем открытый поповер: раньше панель диагностики (и устройства)
 * закрывались только повторным заходом в меню — тапом мимо они не сбрасывались.
 * Сам тап при этом не съедаем: кнопка, по которой попали, сработает как обычно.
 */
const onOverlayPointerDown = (event: PointerEvent) => {
  callStore.resumeOutput()
  const target = event.target
  if (!(target instanceof Node)) return
  if (popoversEl.value?.contains(target)) return
  if (moreBtnEl.value?.contains(target)) return
  closePanels()
}

/** Открыть/закрыть меню «ещё»; панель устройств и меню разом не показываем. */
const toggleMore = () => {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) {
    settingsOpen.value = false
    diagnosticsOpen.value = false
    verifyOpen.value = false
  }
}

const onSpeakerRow = () => {
  toggleSpeaker()
  moreOpen.value = false
}

/**
 * Пункт «Сменить камеру»: просим сторону, а не устройство.
 *
 * Список камер на телефоне бесполезен («camera2 0, facing back»), поэтому
 * переключаем переднюю/заднюю — камеру выберет браузер (см. `facing` в
 * `acquireCameraStream`).
 */
const onSwitchCameraRow = () => {
  void callStore.switchCameraFacing()
  moreOpen.value = false
}

const onScreenRow = () => {
  void callStore.toggleScreenShare()
  moreOpen.value = false
}

const onDevicesRow = () => {
  diagnosticsOpen.value = false
  verifyOpen.value = false
  settingsOpen.value = !settingsOpen.value
  moreOpen.value = false
}

/** Пункт «Эффекты видео»: открывает окно выбора эффекта и маски. */
const onEffectsRow = () => {
  closePanels()
  effectsOpen.value = true
}

/**
 * Перетаскивание маски по своему видео.
 *
 * Считаем по настоящему кадру (`videoWidth/videoHeight`) с учётом обрезки
 * `cover` и зеркала передней камеры — иначе маска уезжает от пальца тем сильнее,
 * чем сильнее отличается соотношение сторон превью и кадра.
 */
const onMaskPointerDown = (event: PointerEvent) => {
  if (!callStore.videoMask || !localVideoEl.value) return
  ;(event.target as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  moveMaskTo(event)
}

const onMaskPointerMove = (event: PointerEvent) => {
  if (!callStore.videoMask) return
  // Тянем только при нажатой кнопке/пальце: иначе маска «прыгала» бы на любой
  // проход курсора по превью.
  if (event.buttons !== 1 && event.pointerType === 'mouse') return
  moveMaskTo(event)
}

const onMaskPointerUp = (event: PointerEvent) => {
  ;(event.target as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
}

const moveMaskTo = (event: PointerEvent) => {
  const el = localVideoEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const frame = {
    width: el.videoWidth || rect.width,
    height: el.videoHeight || rect.height
  }
  const point = framePointFromPointer({
    rect,
    frame,
    mirrored: mirrorLocal.value,
    clientX: event.clientX,
    clientY: event.clientY
  })
  callStore.setVideoMaskLayout({ ...callStore.videoMaskLayout, ...point })
}

/** Пункт «Диагностика звонка»: открывает панель и сразу снимает свежие цифры. */
const onDiagnosticsRow = () => {
  settingsOpen.value = false
  moreOpen.value = false
  verifyOpen.value = false
  diagnosticsOpen.value = !diagnosticsOpen.value
  if (diagnosticsOpen.value) void callStore.refreshDiagnostics()
}

/** Пункт «Код сверки»: показывает код (и заодно пересчитывает его). */
const onVerifyRow = () => {
  settingsOpen.value = false
  moreOpen.value = false
  diagnosticsOpen.value = false
  verifyOpen.value = !verifyOpen.value
  if (verifyOpen.value) void callStore.refreshVerificationCode()
}

/** Есть ли смысл в «окне поверх других»: нужен видеоряд и поддержка PiP. */
const canPictureInPicture = computed(
  () =>
    typeof document !== 'undefined' &&
    document.pictureInPictureEnabled === true &&
    callStore.status === 'active' &&
    !callStore.screenSharing &&
    // Элемент теперь есть всегда, поэтому проверяем именно КАРТИНКУ: без
    // видеодорожки браузер откажет в мини-окне.
    (remoteVideoVisible.value || callStore.peerScreenSharing)
)

/** Свернуть разговор в плавающее окно (картинка в картинке). */
const onPictureInPictureRow = async () => {
  moreOpen.value = false
  const video = remoteVideoEl.value
  if (!video || typeof video.requestPictureInPicture !== 'function') return
  try {
    await video.requestPictureInPicture()
  } catch (error) {
    console.error('Не удалось открыть окно поверх других:', error)
  }
}

/** Умеет ли браузер выводить звук на выбранное устройство (setSinkId). */
const canSelectSpeaker = computed(
  () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
)

const onCameraPick = (value: SelectValue) => void callStore.setCameraDevice(String(value))

const onMicPick = (value: SelectValue) => void callStore.setMicDevice(String(value))

/** Режимы обработки микрофона: шумодав или естественный звук. */
const micModeOptions = [
  { value: 'clean', label: 'Чистый голос' },
  { value: 'natural', label: 'Естественный' }
]

/** Смена обработки звука (перезапрашивает микрофон — см. `setMicProcessing`). */
const onMicModePick = (value: SelectValue) =>
  void callStore.setMicProcessing(value === 'natural' ? 'natural' : 'clean')

/** Вернуть видео, приостановленное из-за связи (решение человека важнее авто-паузы). */
const onResumeVideoRow = () => {
  moreOpen.value = false
  void callStore.resumeVideoForNetwork()
}

const onSpeakerPick = (value: SelectValue) => void callStore.setSpeakerDevice(String(value))

/** Варианты для списков устройств (значение — deviceId, подпись — имя устройства). */
const cameraOptions = computed(() =>
  callStore.cameras.map((cam) => ({ value: cam.deviceId, label: cam.label || 'Камера' }))
)

const micOptions = computed(() =>
  callStore.microphones.map((mic) => ({ value: mic.deviceId, label: mic.label || 'Микрофон' }))
)

const speakerOptions = computed(() =>
  callStore.speakers.map((spk) => ({ value: spk.deviceId, label: spk.label || 'Динамик' }))
)

/** Направляет звук на выбранный динамик (Safari/iOS не поддерживают — молча пропускаем). */
const applySink = () => {
  if (!canSelectSpeaker.value || !callStore.selectedSpeaker) return
  const parent = remoteVideoEl.value
  type SinkCapable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  const el = parent as SinkCapable | null
  if (!el?.setSinkId) return
  void el.setSinkId(callStore.selectedSpeaker).catch(() => undefined)
}

/** Элемент вывода звука: удалённый поток всегда привязан к нему. */
const fallbackEl = (): HTMLMediaElement | null => remoteVideoEl.value

const applySpeaker = () => {
  if (callStore.outputReady()) {
    // Web Audio работает — громкость честная (тихо/громко).
    callStore.setOutputVolume(speakerOn.value ? 1 : EARP_VOLUME)
  } else {
    // Web Audio не готов — звук идёт через элемент (громкость элемента на части
    // телефонов игнорируется, но по крайней мере звонок слышно).
    const el = fallbackEl()
    if (el) el.volume = speakerOn.value ? 1 : EARP_VOLUME
  }
}

const toggleSpeaker = () => {
  speakerOn.value = !speakerOn.value
  applySpeaker()
}

const avatarUrl = computed<string | undefined>(() => {
  const path = callStore.peerAvatar
  return path ? mediaUrl(path) : undefined
})

const displayName = computed<string>(() => {
  const name = callStore.peerName.trim()
  return name ? name : `Пользователь ${callStore.peerId ?? ''}`.trim()
})

const displayNameInitials = computed<string>(() => userInitials(displayName.value))

const avatarStyle = (name: string): Record<string, string> => userAvatarStyle(name)

// Если аватар не загрузился — показываем инициалы на градиенте вместо «битой»
// картинки (которая на некоторых устройствах рисуется чёрным квадратом).
const avatarImgFailed = ref(false)
watch(avatarUrl, () => {
  avatarImgFailed.value = false
})

// Явно запускаем воспроизведение (на мобильных autoplay-атрибут не всегда
// стартует после назначения srcObject, из-за чего видео чёрное при живом звуке).
const ensurePlaying = (el: HTMLMediaElement | null) => {
  if (el && el.srcObject && el.paused) {
    void el.play().catch(() => undefined)
  }
}

let lastRemoteVideoTracks = 0

const attachStreams = () => {
  const remote = callStore.getRemoteStream()

  // Пытаемся держать Web Audio запущенным; если он не готов — звук идёт
  // напрямую через элемент (фолбэк), чтобы звонок не был немым.
  callStore.resumeOutput()
  const viaWeb = callStore.outputReady()

  // Один и тот же элемент и для видео, и для звука: аудио-дорожка играется
  // `<video>` не хуже `<audio>`, а лишняя сущность означала бы два пути вывода
  // для одного потока (и «двойной звук», который мы уже ловили).
  const remoteVideo = remoteVideoEl.value
  const videoTracks = remote ? remote.getVideoTracks().length : 0
  remoteVideoTracks.value = videoTracks
  if (remoteVideo) {
    const needsBind =
      remoteVideo.srcObject !== remote ||
      // Видеотрек мог прийти позже аудио — пере-привязываем, чтобы «проснуться».
      (videoTracks > 0 && videoTracks !== lastRemoteVideoTracks && remoteVideo.srcObject === remote)
    if (needsBind) {
      remoteVideo.srcObject = null
      remoteVideo.srcObject = remote
    }
    // Web Audio играет звук → глушим элемент (он остаётся ради картинки и ради
    // того, чтобы Chrome вообще отдавал поток в Web Audio); иначе — фолбэк.
    remoteVideo.muted = viaWeb
    ensurePlaying(remoteVideo)
  }
  lastRemoteVideoTracks = videoTracks

  const local = callStore.getLocalStream()
  if (localVideoEl.value && localVideoEl.value.srcObject !== local) {
    localVideoEl.value.srcObject = local
  }
  ensurePlaying(localVideoEl.value)
  applySpeaker()
  applySink()
}

watch(
  () => callStore.status,
  (status) => {
    if (status === 'active') {
      if (attachTimer !== undefined) window.clearInterval(attachTimer)
      attachTimer = window.setInterval(attachStreams, 350)
      window.setTimeout(attachStreams, 100)
    } else if (attachTimer !== undefined) {
      window.clearInterval(attachTimer)
      attachTimer = undefined
      speakerOn.value = false
      settingsOpen.value = false
      diagnosticsOpen.value = false
      verifyOpen.value = false
      copiedDiagnostics.value = false
      moreOpen.value = false
    }
  }
)

// Демонстрация экрана могла включиться из аудиозвонка (или наоборот завершиться) —
// перебрасываем потоки в правильные элементы без ожидания следующего тика.
watch(
  () => [callStore.kind, callStore.screenSharing, callStore.selectedSpeaker],
  () => {
    void nextTick(attachStreams)
  }
)

// Камеру собеседник мог включить/выключить — перебрасываем потоки в элемент
// (и обратно), не дожидаясь следующего тика обновления.
watch(
  () => callStore.peerVideoOn,
  () => {
    void nextTick(attachStreams)
  }
)

// Показ экрана могли остановить из плашки браузера, а не из меню — прячем меню,
// чтобы его подписи не расходились с состоянием звонка.
watch(
  () => callStore.screenSharing,
  () => {
    moreOpen.value = false
  }
)

watch(
  () => callStore.notice,
  (notice) => {
    if (!notice) return
    noticeVisible.value = true
    if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(hideNotice, 3500)
  }
)

const hideNotice = () => {
  noticeVisible.value = false
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer)
    noticeTimer = undefined
  }
  callStore.resetNotice()
}

onBeforeUnmount(() => {
  if (attachTimer !== undefined) window.clearInterval(attachTimer)
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
})
</script>

<style scoped>
.call-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(1200px 700px at 50% 20%, #243143, #10161e 70%);
  color: #fff;
  font-family: var(--ms-font);
  user-select: none;
  overflow: hidden;
  /* Жест «потянуть вниз» не должен уходить в документ: браузер понял бы это как
     pull-to-refresh и перезагрузил страницу прямо во время разговора. */
  overscroll-behavior: none;
  touch-action: manipulation;
}

.call-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px;
}

/*
 * Групповой звонок: плашка, сетка плиток и кнопки — три строки друг под другом.
 * Раньше плашка была слоем поверх плиток и закрывала у верхних кнопку сброса,
 * а панель кнопок ложилась на низ плиток.
 */
.group-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 12px 12px 8px;
}

.active-ui.group {
  gap: 8px;
  padding: 12px 12px 8px;
}

.group-stage .call-grid,
.active-ui.group .call-grid {
  flex: 1 1 0;
  /* Перебиваем `height: 100%` из самой сетки: с ним она растягивалась на весь
     экран и вылезала под плашку и под кнопки. */
  height: auto;
  min-height: 0;
}

/* Плашка вызова — та же строка, что и плашка разговора: подпись слева,
   отмена справа. */
.group-ringing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex: 0 0 auto;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 16px;
  padding: 10px 16px;
  backdrop-filter: blur(6px);
}

.active-ui.group .active-controls,
.group-stage .group-ringing {
  position: static;
  flex: 0 0 auto;
}

/* Своя картинка уже есть плиткой «Вы» — второе превью только закрывало плитки. */
.active-ui.group .local-video {
  display: none;
}

.call-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 2.6rem;
  color: #fff;
  overflow: hidden;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.35);
  margin-bottom: 12px;
  animation: avatar-pulse 1.6s ease-in-out infinite;
}

.call-avatar.huge {
  width: 180px;
  height: 180px;
  font-size: 3.8rem;
  animation: none;
}

@keyframes avatar-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(80, 200, 120, 0.35);
  }
  50% {
    box-shadow: 0 0 0 22px rgba(80, 200, 120, 0);
  }
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.call-name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  text-align: center;
}

.call-name.audio-name {
  font-size: 24px;
}

.call-subtitle {
  margin: 0 0 18px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
}

.call-subtitle.audio-sub {
  margin-bottom: 26px;
}

/* ---------- Видеорежим ---------- */
.remote-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

/* Показывать нечего (аудио-звонок или камера выключена): элемент остаётся в
   разметке и продолжает держать звук, но не занимает экран. */
.remote-video.remote-hidden {
  opacity: 0;
  pointer-events: none;
  background: transparent;
}

.active-ui {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  /* Сверху вниз: плашка с именем и маршрутом — своя верхняя строка (не поверх
     картинки и не поверх кнопок), дальше — сетка/аватар, внизу — кнопки. */
  justify-content: flex-start;
  flex-direction: column;
  padding: 12px;
}

.active-ui.audio {
  position: static;
}

.video-hud {
  /* Отдельная верхняя строка, а не плавающее окно: у краёв лежат кнопки
     (сброс участника в плитке сверху, отключение звонка снизу) — плашка их
     больше не загораживает. */
  position: static;
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 16px;
  padding: 10px 16px;
  backdrop-filter: blur(6px);
}

.hud-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}

.hud-info {
  display: flex;
  flex-direction: column;
}

.hud-name {
  font-size: 15px;
  font-weight: 600;
}

.hud-time {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.75);
}

/* Плашка «сквозное шифрование» (WebRTC = DTLS-SRTP) */
.call-e2ee {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.9);
  font-size: var(--ms-fs-xs);
  background: rgba(46, 162, 94, 0.18);
  border: 1px solid rgba(46, 162, 94, 0.4);
  border-radius: 999px;
  padding: 2px 9px;
  user-select: none;
}

.call-e2ee .q-icon {
  color: #58d68d;
  font-size: 1.05rem;
}

.call-e2ee.video {
  align-self: flex-start;
  margin-top: 3px;
  font-size: var(--ms-fs-xs);
  padding: 1px 7px;
}

/* Плашка «собеседник показывает экран» */
.call-sharing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: #fff;
  font-size: var(--ms-fs-xs);
  background: rgba(58, 166, 224, 0.22);
  border: 1px solid rgba(58, 166, 224, 0.5);
  border-radius: 999px;
  padding: 2px 10px;
  user-select: none;
}

.call-sharing .q-icon {
  color: #6cc4f0;
  font-size: 1.05rem;
}

.call-sharing.video {
  align-self: flex-start;
  margin-top: 3px;
  font-size: var(--ms-fs-xs);
  padding: 1px 7px;
}

.local-video {
  position: absolute;
  right: 18px;
  bottom: 110px;
  width: 180px;
  max-width: 32vw;
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  background: #111;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 5;
}

/* Зеркало — только у передней камеры (см. `mirrorLocal`). */
.local-video.mirrored {
  transform: scaleX(-1);
}

/* Маска выбрана: превью становится площадкой, по которой её двигают пальцем. */
.local-video.mask-drag {
  cursor: grab;
  touch-action: none;
}

.local-video.mask-drag:active {
  cursor: grabbing;
}

.ctl-btn.speaker-on {
  color: var(--ms-accent, #2ea25e);
}

/* Кнопка демонстрации экрана в активном состоянии */
.ctl-btn.screen-on {
  background: #3aa6e0;
}

/* ---------- Меню «ещё» (редкие действия во время звонка) ---------- */
.call-more {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: min(300px, calc(100vw - 40px));
  padding: 8px;
  background: rgba(16, 22, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.more-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
}

.more-row:hover,
.more-row.on {
  background: rgba(255, 255, 255, 0.12);
}

.more-row .more-mark {
  margin-left: auto;
  opacity: 0.85;
}

/* ---------- Собеседник выключил камеру: аватар вместо чёрного экрана ---------- */
.peer-video-off {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: radial-gradient(900px 600px at 50% 35%, #22303f, #0f151c 75%);
}

.peer-video-off-text {
  margin: 0;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.72);
}

/* ---------- Бейджи: микрофон собеседника и качество связи ---------- */
.call-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 8px;
}

.call-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--ms-fs-xs);
  background: rgba(255, 255, 255, 0.16);
}

.call-badge.fair {
  background: rgba(255, 193, 7, 0.24);
}

.call-badge.bad {
  background: rgba(244, 67, 54, 0.3);
}

/* Свой показ экрана: не ошибка и не «плохая связь» — спокойный синий, как у
   кнопки показа в активном состоянии. */
.call-badge.share {
  background: rgba(58, 166, 224, 0.3);
}

/* Пояснение в меню «ещё» (например, почему показа экрана нет). */
.more-note {
  margin: 0;
  padding: 6px 10px;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
  color: var(--ms-muted, #71808d);
}

/* ---------- Код сверки звонка ---------- */
/* Панель в том же слое, что диагностика: показывает 6 цифр, одинаковых у обоих
   участников. Крупно и с разрядкой — код диктуют вслух. */
.call-verify {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 14px;
  background: rgba(16, 22, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.verify-code {
  font-family: var(--ms-font-mono, monospace);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-align: center;
  color: #fff;
}

.verify-hint {
  margin: 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.76);
}

/* ---------- Панель диагностики звонка ---------- */
.call-diagnostics {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 14px;
  background: rgba(16, 22, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.diag-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.diag-label {
  color: rgba(255, 255, 255, 0.6);
}

.diag-value {
  text-align: right;
}

.diagnostics-hint {
  margin: 0;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.65);
}

.diag-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.diag-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.diag-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* ---------- Панель устройств звонка ---------- */
.call-settings {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  padding: 12px 14px;
  background: rgba(16, 22, 30, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-label {
  font-size: var(--ms-fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(255, 255, 255, 0.6);
}

.settings-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

@media (max-width: 420px) {
  .active-controls {
    gap: 11px;
  }

  .ctl-btn {
    width: 50px;
    height: 50px;
    font-size: 1.25rem;
  }

  .ctl-btn.big {
    width: 58px;
    height: 58px;
  }

  .call-settings {
    bottom: 96px;
  }

  .call-more {
    bottom: 96px;
  }
}

/* ---------- Управление ---------- */
.call-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}

.incoming-controls {
  gap: 40px;
  margin-top: 14px;
}

.active-controls {
  position: absolute;
  bottom: 34px;
  left: 0;
  right: 0;
  gap: 20px;
  z-index: 6;
}

.ctl-btn {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 1.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.12s,
    background 0.12s;
}

.ctl-btn:hover {
  transform: scale(1.07);
  background: rgba(255, 255, 255, 0.3);
}

.ctl-btn.accept {
  background: var(--ms-accent, #2ea25e);
}

.ctl-btn.accept:hover {
  background: var(--ms-accent-strong, #26884a);
}

.ctl-btn.danger {
  background: #e04545;
}

.ctl-btn.danger:hover {
  background: #ee5555;
}

.ctl-btn.big {
  width: 66px;
  height: 66px;
  font-size: 1.6rem;
}

/* Косой штрих на «выключенных» кнопках */
.ctl-btn.off::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 8%;
  width: 3px;
  height: 84%;
  background: #fff;
  border-radius: 2px;
  transform: translateX(-50%) rotate(-45deg);
}

.ctl-btn.danger.off::after {
  background: #fff;
}

/* ---------- Тост ---------- */
.call-reconnect {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.55);
  color: #f2f5f8;
  font-size: 13px;
  z-index: 5;
}

.call-reconnect-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: call-reconnect-spin 0.8s linear infinite;
}

@keyframes call-reconnect-spin {
  to {
    transform: rotate(360deg);
  }
}

.call-notice {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4100;
  background: rgba(20, 26, 33, 0.92);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}

.call-fade-enter-active,
.call-fade-leave-active {
  transition: opacity 0.22s;
}

.call-fade-enter-from,
.call-fade-leave-to {
  opacity: 0;
}
</style>
