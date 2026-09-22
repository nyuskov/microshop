<template>
  <div class="stories-feed">
    <div v-if="stories.loading && !stories.groups.length" class="sk-list" aria-busy="true">
      <span class="sr-only">{{ t('Загружаем истории…') }}</span>
      <div v-for="n in 5" :key="n" class="sk-row">
        <span class="sk-avatar"></span>
        <span class="sk-lines">
          <span class="sk-line" :style="{ width: 35 + ((n * 11) % 40) + '%' }"></span>
          <span class="sk-line short"></span>
        </span>
      </div>
    </div>

    <template v-else-if="stories.groups.length">
      <button
        v-for="group in stories.groups"
        :key="group.user.id"
        class="feed-row"
        type="button"
        @click="emit('open-story', firstStoryId(group))"
      >
        <span
          class="feed-avatar"
          :class="{ unseen: group.has_unseen && !group.is_mine }"
          :style="avatarStyle(authorName(group))"
        >
          <img
            v-if="authorAvatar(group)"
            :src="authorAvatar(group)"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ authorInitials(group) }}</template>
          <span v-if="group.has_unseen && !group.is_mine" class="feed-dot"></span>
        </span>
        <span class="feed-text">
          <span class="feed-name">
            {{ group.is_mine ? t('Моя история') : authorName(group) }}
          </span>
          <span class="feed-meta">
            {{ formatStoryAge(group.items[0].created_at) }} ·
            {{ group.items.length }}
            {{
              plural(group.items.length, ['история', 'истории', 'историй'], ['story', 'stories'])
            }}
            <template v-if="group.is_mine">
              · {{ t('просмотров: {count}', { count: totalViews(group) }) }}
            </template>
          </span>
        </span>
        <q-icon :name="icon('chevron_right')" size="20px" class="feed-chevron" />
      </button>
    </template>

    <div v-else class="stories-empty-block">
      <q-icon :name="icon('auto_stories')" size="34px" />
      <p class="stories-empty-title">{{ t('Историй пока нет') }}</p>
      <p class="stories-empty-hint">
        {{
          t(
            'История — это фото или видео на 24 часа. Друзья увидят её в этом разделе и в списке чатов.'
          )
        }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { mediaUrl } from '@/config'
import type { StoryGroup } from '@/services/stories'
import { useStoriesStore } from '@/stores/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { formatStoryAge } from '@/utils/stories'
import { plural, t } from '@/i18n'

const emit = defineEmits<{
  (e: 'open-story', storyId: number): void
}>()

const stories = useStoriesStore()

const authorName = (group: StoryGroup) => displayName(group.user) || `@${group.user.username}`

const authorAvatar = (group: StoryGroup) => {
  const path = avatarUrlOf(group.user)
  return path ? mediaUrl(path) : ''
}

const authorInitials = (group: StoryGroup) => initials(authorName(group))

/** Своя история — с первой; чужая — с первой непросмотренной. */
const firstStoryId = (group: StoryGroup): number => {
  if (group.is_mine) return group.items[0].id
  const unseen = group.items.find((item) => !item.viewed)
  return (unseen ?? group.items[0]).id
}

const totalViews = (group: StoryGroup): number =>
  group.items.reduce((sum, item) => sum + item.views, 0)
</script>

<style scoped>
.stories-feed {
  display: flex;
  flex-direction: column;
  padding: 8px 0 4px;
}

.feed-row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: 11px 14px;
  border: none;
  background: transparent;
  color: var(--ms-text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 0.15s ease;
}

.feed-row:hover {
  background: var(--ms-hover);
}

.feed-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  font-weight: 600;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  flex: 0 0 auto;
  box-shadow: 0 0 0 2px var(--ms-border);
}

.feed-avatar.unseen {
  box-shadow: 0 0 0 2.5px var(--ms-accent);
}

.feed-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.feed-dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--ms-surface);
  background: var(--ms-accent);
}

.feed-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.feed-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
}

.feed-meta {
  font-size: 12.5px;
  line-height: 1.3;
  color: var(--ms-muted);
}

.feed-chevron {
  margin-left: auto;
  color: var(--ms-muted-3);
}

.stories-empty {
  margin: 18px 14px;
  color: var(--ms-muted);
}

.stories-empty-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 24px;
  text-align: center;
  color: var(--ms-muted);
}

.stories-empty-title {
  margin: 6px 0 0;
  font-weight: 600;
  color: var(--ms-text);
}

.stories-empty-hint {
  margin: 0;
  font-size: 12.5px;
}
</style>
