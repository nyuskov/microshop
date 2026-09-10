/** Истории (статусы): лента, публикация, просмотры. */

import { defineStore } from 'pinia'

import {
  deleteStory,
  fetchStories,
  publishStory,
  viewStory,
  type StoryGroup
} from '@/services/stories'
import { getErrorMessage } from '@/services/errors'

interface StoriesState {
  groups: StoryGroup[]
  loading: boolean
  /** Лента хотя бы раз загружена (чтобы не мигать пустым блоком на старте). */
  loaded: boolean
  error: string
  publishing: boolean
}

export const useStoriesStore = defineStore('stories', {
  state: (): StoriesState => ({
    groups: [],
    loading: false,
    loaded: false,
    error: '',
    publishing: false
  }),

  getters: {
    /** Есть ли хоть какие-то истории (для полосы в списке чатов). */
    hasAny: (state): boolean => state.groups.length > 0,
    /** Есть ли непросмотренные истории других людей (точка в навигации). */
    hasUnseen: (state): boolean => state.groups.some((group) => !group.is_mine && group.has_unseen),
    /** Мои истории (для кнопки «Моя история»). */
    mine: (state): StoryGroup | null => state.groups.find((group) => group.is_mine) ?? null,
    /** Истории других людей в порядке показа. */
    others: (state): StoryGroup[] => state.groups.filter((group) => !group.is_mine)
  },

  actions: {
    /** Загружает ленту (тихо: при ошибке показываем прошлые данные). */
    async load(): Promise<void> {
      if (this.loading) return
      this.loading = true
      try {
        this.groups = await fetchStories()
        this.error = ''
        this.loaded = true
      } catch (error) {
        this.error = getErrorMessage(error, 'Не удалось загрузить истории')
      } finally {
        this.loading = false
      }
    },

    /** Публикует историю и обновляет ленту. */
    async publish(file: File, caption = ''): Promise<boolean> {
      if (this.publishing) return false
      this.publishing = true
      try {
        await publishStory(file, caption)
        await this.load()
        return true
      } catch (error) {
        this.error = getErrorMessage(error, 'Не удалось опубликовать историю')
        return false
      } finally {
        this.publishing = false
      }
    },

    /** Отмечает историю просмотренной (без перезагрузки всей ленты). */
    async markViewed(storyId: number): Promise<void> {
      const group = this.groups.find((item) => item.items.some((story) => story.id === storyId))
      const story = group?.items.find((item) => item.id === storyId)
      if (!group || !story || story.viewed || group.is_mine) return
      try {
        await viewStory(storyId)
        story.viewed = true
        story.views += 1
        group.has_unseen = group.items.some((item) => !item.viewed)
      } catch {
        /* просмотр — не критично: при следующей загрузке ленты состояние уточнится */
      }
    },

    /** Удаляет свою историю. */
    async remove(storyId: number): Promise<boolean> {
      try {
        await deleteStory(storyId)
        this.groups = this.groups
          .map((group) => ({
            ...group,
            items: group.items.filter((story) => story.id !== storyId)
          }))
          .filter((group) => group.items.length > 0)
        return true
      } catch (error) {
        this.error = getErrorMessage(error, 'Не удалось удалить историю')
        return false
      }
    },

    /** Полная очистка (выход из аккаунта). */
    reset(): void {
      this.$patch({ groups: [], loaded: false, error: '' })
    }
  }
})
