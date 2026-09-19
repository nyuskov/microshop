<template>
  <!-- Расшифровка: распознаёт устройство, текст никуда не отправляется. -->
  <div v-if="transcript && transcript.status !== 'running'" class="am-transcript">
    <p v-if="transcript.status === 'ready'" class="am-transcript-text">{{ transcript.text }}</p>
    <p v-else class="am-transcript-error">{{ transcript.error }}</p>
    <!-- Кнопка переключения стоит у вызывающего компонента (в голосовом — в
         строке с названием, у кружка — отдельно), поэтому здесь только то, чего
         там нет: копирование готового текста и повтор после ошибки. -->
    <div
      v-if="transcript.status === 'ready' || transcript.status === 'failed'"
      class="am-transcript-actions"
    >
      <button v-if="transcript.status === 'ready'" class="am-transcript-btn" @click="copy">
        Скопировать
      </button>
      <!-- «Ещё раз» есть и при готовом тексте: после улучшений распознавания
           старый текст хочется переиграть, а не только скрыть. -->
      <button class="am-transcript-btn" @click="retry">Ещё раз</button>
    </div>
    <!-- Язык выбирается тут же, а не в настройках: неправильный язык — главная
         причина чужого текста («Привет» → «private»). -->
    <div class="am-lang">
      <span class="am-lang-title">Язык речи</span>
      <div class="am-lang-list">
        <button
          class="am-lang-btn"
          :class="{ active: speechLanguage === '' }"
          :aria-pressed="speechLanguage === ''"
          @click="setSpeechLanguage('')"
        >
          Авто
        </button>
        <button
          v-for="item in SPEECH_LANGUAGES"
          :key="item.code"
          class="am-lang-btn"
          :class="{ active: speechLanguage === item.code }"
          :aria-pressed="speechLanguage === item.code"
          @click="setSpeechLanguage(item.code)"
        >
          {{ item.label }}
        </button>
      </div>
      <p v-if="transcript.status === 'failed'" class="am-lang-hint">
        Если слова не те — попробуйте другой язык и нажмите «Ещё раз».
      </p>
    </div>
    <p class="am-transcript-note">
      Распознаёт браузер устройства — в E2EE-чате текст на сервер не уходит, но распознавание может
      обращаться к сервису браузера.
    </p>
  </div>

  <p v-if="transcript?.status === 'running'" class="am-transcript-note am-transcript-note--live">
    {{ transcript.text || 'Слушаем запись…' }}
    <!-- Язык виден здесь, а не в настройках: если текст вышел чужими словами,
         причина видна сразу («private» вместо «привет» — это английская модель). -->
    <span class="am-lang-used">{{ speechLanguageInUse }}</span>
  </p>
</template>

<script setup lang="ts">
/**
 * Блок расшифровки под голосовым или видеосообщением.
 *
 * Общий для `AudioMessage.vue` и `RoundVideoMessage.vue`: текст, действия
 * (скопировать, повторить), выбор языка речи и честная подпись о том, кто
 * распознаёт. Состояние берётся из `utils/voiceRecognition` по id сообщения —
 * поэтому текст не пропадает при перерисовке ленты.
 */
import { computed } from 'vue'

import {
  clearTranscript,
  recognizeVoice,
  setSpeechLanguage,
  SPEECH_LANGUAGES,
  speechLanguage,
  speechLanguageInUse,
  transcriptOf
} from '@/utils/voiceRecognition'

const props = defineProps<{
  /** Id сообщения: по нему помним расшифровку при перерисовке ленты. */
  messageId: number
  /** Ссылка на файл записи (голосовое или видеосообщение). */
  src: string
}>()

const transcript = computed(() => transcriptOf(props.messageId))

const retry = () => {
  void recognizeVoice(props.messageId, props.src)
}

const copy = async () => {
  const text = transcript.value?.text
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* нет разрешения на буфер обмена — текст видно и так */
  }
}

/** Скрыть расшифровку можно и отсюда: кнопка у вызывающего компонента. */
defineExpose({ hide: () => clearTranscript(props.messageId) })
</script>

<style scoped>
/* Расшифровка под голосовым: границу даёт полоса слева, как у цитаты. */
.am-transcript {
  margin-top: 6px;
  padding-left: 8px;
  border-left: 2px solid var(--ms-border, #dfe5ea);
}

.am-transcript-text {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.35;
  color: var(--ms-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.am-transcript-error {
  margin: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-danger, #d64545);
}

.am-transcript-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.am-transcript-btn {
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}

.am-transcript-note {
  margin: 4px 0 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
  color: var(--ms-muted, #71808d);
}

.am-transcript-note--live {
  font-style: italic;
}

.am-lang-used {
  margin-left: 4px;
  font-style: normal;
  color: var(--ms-muted, #71808d);
}

/* Язык речи: нужен там же, где и текст, — иначе человек не поймёт, почему
   «Привет» распознался как «private». */
.am-lang {
  margin-top: 6px;
}

.am-lang-title {
  display: block;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
}

.am-lang-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.am-lang-btn {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 8px;
  background: transparent;
  color: var(--ms-text);
  font-size: var(--ms-fs-xs);
  line-height: 1.2;
  padding: 3px 7px;
  cursor: pointer;
}

.am-lang-btn.active {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
  color: var(--ms-accent, #2ea25e);
}

.am-lang-hint {
  margin: 4px 0 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
  color: var(--ms-muted, #71808d);
}
</style>
