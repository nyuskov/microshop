<template>
  <div class="stories-feed">
    <p v-if="stories.loading && !stories.groups.length" class="stories-empty">Загружаем истории…</p>

    <template v-else-if="stories.groups.length">
      <button
        v-for="group in stories.groups"
        :key="group.user.id"
        class="feed-row"
        type="button"
        @click="emit('open-story', firstStoryId(group))"
      >
        <span class="feed-avatar" :class="{ unseen: group.has_unseen && !group.is_mine }">
          <img v-if="authorAvatar(group)" :src="authorAvatar(group)" alt="" />
          <template v-else>{{ authorInitials(group) }}</template>
          <span v-if="group.has_unseen && !group.is_mine" class="feed-dot"></span>
        </span>
        <span class="feed-text">
          <span class="feed-name">
            {{ group.is_mine ? 'Моя история' : authorName(group) }}
          </span>
          <span class="feed-meta">
            {{ formatStoryAge(group.items[0].created_at) }} ·
            {{ group.items.length }}
            {{ group.items.length === 1 ? 'история' : 'истории' }}
            <template v-if="group.is_mine"> · просмотров: {{ totalViews(group) }}</template>
          </span>
        </span>
        <q-icon name="chevron_right" size="20px" class="feed-chevron" />
      </button>
    </template>

    <div v-else class="stories-empty-block">
      <q-icon name="auto_stories" size="34px" />
      <p class="stories-empty-title">Историй пока нет</p>
      <p class="stories-empty-hint">
        История — это фото или видео на 24 часа. Друзья увидят её в этом разделе и в списке чатов.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { mediaUrl } from '@/config'
import type { StoryGroup } from '@/services/stories'
import { useStoriesStore } from '@/stores/stories'
import { avatarUrlOf, displayName, initials } from '@/utils/user'
import { formatStoryAge } from '@/utils/stories'

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
  padding: 6px 0;
}

.feed-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--ms-text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.feed-row:hover {
  background: var(--ms-hover);
}

.feed-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
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
  right: 1px;
  bottom: 1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--ms-surface);
  background: var(--ms-accent);
}

.feed-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.feed-name {
  font-weight: 600;
}

.feed-meta {
  font-size: 12.5px;
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
  gap: 6px;
  padding: 40px 22px;
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
