/** Истории (статусы): лента, публикация, просмотры. */

import { defineStore } from 'pinia'

import {
  deleteStory,
  FALLBACK_STORY_REACTIONS,
  FALLBACK_STORY_REACTIONS_PRIMARY,
  fetchStories,
  publishStory,
  reactToStory,
  viewStory,
  type StoryGroup
} from '@/services/stories'
import { getErrorMessage } from '@/services/errors'
import { toggleReaction } from '@/utils/stories'

interface StoriesState {
  groups: StoryGroup[]
  loading: boolean
  /** Лента хотя бы раз загружена (чтобы не мигать пустым блоком на старте). */
  loaded: boolean
  error: string
  publishing: boolean
  /** Допустимые реакции: приходят с сервером, чтобы панель и API не разъезжались. */
  reactionKinds: string[]
  /** Сколько кнопок реакций показывать сразу. */
  reactionsPrimary: number
}

/**
 * Текущая загрузка ленты. Ждать её должны все, кто её запросил: раньше
 * повторный вызов `load()` выходил сразу, и код холодного старта по push
 * (`openStoryFromPush`) успевал проверить ещё пустую ленту и не найти историю.
 */
let feedLoad: Promise<void> | null = null

export const useStoriesStore = defineStore('stories', {
  state: (): StoriesState => ({
    groups: [],
    loading: false,
    loaded: false,
    error: '',
    publishing: false,
    reactionKinds: [...FALLBACK_STORY_REACTIONS],
    reactionsPrimary: FALLBACK_STORY_REACTIONS_PRIMARY
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
      // Уже грузим — отдаём тот же промис: вызывающий дождётся свежей ленты.
      if (feedLoad) return feedLoad
      feedLoad = (async () => {
        this.loading = true
        try {
          const feed = await fetchStories()
          this.groups = feed.groups
          this.reactionKinds = feed.reactionKinds
          this.reactionsPrimary = feed.reactionsPrimary
          this.error = ''
          this.loaded = true
        } catch (error) {
          this.error = getErrorMessage(error, 'Не удалось загрузить истории')
        } finally {
          this.loading = false
          feedLoad = null
        }
      })()
      return feedLoad
    },

    /** Публикует историю и обновляет ленту.
     *
     * `transcode` — браузер не смог проиграть выбранное видео (см.
     * `probeVideoPlayback` в `utils/stories.ts`): сервер перекодирует его, чтобы
     * история не оказалась чёрным экраном у зрителей.
     */
    async publish(
      file: File,
      caption = '',
      options: { transcode?: boolean } = {}
    ): Promise<boolean> {
      if (this.publishing) return false
      this.publishing = true
      try {
        await publishStory(file, caption, options)
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

    /**
     * Ставит или снимает реакцию на историю.
     *
     * Сначала меняем состояние локально (панель обязана отвечать мгновенно),
     * затем уточняем сводку по ответу сервера; при ошибке возвращаем как было —
     * так расхождение с сервером не залипает.
     */
    async react(storyId: number, emoji: string): Promise<void> {
      const group = this.groups.find((item) => item.items.some((story) => story.id === storyId))
      const story = group?.items.find((item) => item.id === storyId)
      // На свою историю реакций не бывает (сервер её всё равно отклонит).
      if (!story || group?.is_mine) return

      const previous = story.reactions.map((item) => ({ ...item }))
      story.reactions = toggleReaction(story.reactions, emoji, this.reactionKinds)
      try {
        const updated = await reactToStory(storyId, emoji)
        story.reactions = updated.reactions
      } catch (error) {
        story.reactions = previous
        this.error = getErrorMessage(error, 'Не удалось поставить реакцию')
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
