<template>
  <!-- Вся карточка — ссылка: нажатие открывает сайт, но только после
       подтверждения «Переход на внешний сайт» (см. useExternalLinkGuard).
       href оставляем: по нему работают «скопировать адрес» и контекстное меню. -->
  <a
    class="lp-card"
    :href="preview.url"
    rel="noopener noreferrer"
    @click.stop.prevent="openPreview"
  >
    <img
      v-if="imageSrc"
      class="lp-image"
      :src="imageSrc"
      :alt="preview.title || domain"
      loading="lazy"
      decoding="async"
      @error="imageFailed = true"
    />
    <span class="lp-body">
      <span class="lp-site">{{ preview.site_name || domain }}</span>
      <span v-if="preview.title" class="lp-title">{{ preview.title }}</span>
      <span v-if="preview.description" class="lp-desc">{{ preview.description }}</span>
    </span>
  </a>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LinkPreview } from '@/types'
import { mediaUrl } from '@/config'
import { followLink } from '@/composables/useExternalLinkGuard'
import { linkDomainOf, prettyLink } from '@/utils/linkPreview'

const props = defineProps<{ preview: LinkPreview }>()

/** Картинка не загрузилась (сайт её забрал/файл удалён) — просто не показываем. */
const imageFailed = ref(false)

/** Переход по ссылке — через общее подтверждение внешнего перехода. */
const openPreview = () => {
  void followLink(props.preview.url)
}

const imageSrc = computed<string | null>(() => {
  if (imageFailed.value || !props.preview.image_url) return null
  // Картинку хранит наш сервер (server сам её скачал), поэтому путь локальный.
  return mediaUrl(props.preview.image_url)
})

const domain = computed<string>(
  () => props.preview.domain || linkDomainOf(props.preview.url) || prettyLink(props.preview.url)
)
</script>

<style scoped>
.lp-card {
  display: flex;
  flex-direction: column;
  margin-top: 6px;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 12px;
  background: var(--ms-surface, #ffffff);
  text-decoration: none;
  transition: background 0.15s;
}

.lp-card:hover {
  background: var(--ms-hover, #f2f4f6);
}

.lp-image {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  background: var(--ms-surface-2, #f0f2f5);
}

.lp-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
}

.lp-site {
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--ms-muted, #71808d);
}

.lp-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ms-text-strong, #141d26);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.lp-desc {
  font-size: 13px;
  line-height: 1.35;
  color: var(--ms-muted, #71808d);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
