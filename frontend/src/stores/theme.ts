import { defineStore } from 'pinia'

type Theme = 'light' | 'dark'

export const useThemeStore = defineStore('theme', {
  state: () => ({
    currentTheme: 'dark' as Theme, // Default theme changed to 'dark'
    isSidebarCollapsed: false // State for the collapsible sidebar (now used for drawer)
  }),

  actions: {
    setTheme(theme: string) {
      if (['light', 'dark'].includes(theme)) {
        this.currentTheme = theme as Theme
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('app-theme', theme) // Save preference to localStorage
      }
    },

    toggleTheme() {
      const newTheme: Theme = this.currentTheme === 'light' ? 'dark' : 'light'
      this.setTheme(newTheme)
    },

    initializeTheme() {
      // Check for saved theme preference or default to 'dark'
      const savedTheme = localStorage.getItem('app-theme') || 'dark'
      this.setTheme(savedTheme)
    },

    // Action to toggle the sidebar collapse state
    toggleSidebarCollapse() {
      this.isSidebarCollapsed = !this.isSidebarCollapsed
      // Optionally save this state to localStorage as well
      localStorage.setItem('sidebar-collapsed', this.isSidebarCollapsed.toString())
    },

    // Action to initialize the sidebar state from localStorage
    initializeSidebarState() {
      const savedState = localStorage.getItem('sidebar-collapsed')
      if (savedState !== null) {
        this.isSidebarCollapsed = savedState === 'true'
      }
    }
  }
})
