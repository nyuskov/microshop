import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000'; // Замените на URL вашего бэкенда

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');

const auth = {
  async login(username, password) {
    try {
      const response = await apiClient.post('/api/v1/auth/token/', {
        username,
        password,
      });

      accessToken = response.data.access_token;
      refreshToken = response.data.refresh_token;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  logout() {
    accessToken = null;
    refreshToken = null;

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');

    delete apiClient.defaults.headers.common['Authorization'];
  },

  async refreshToken() {
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await apiClient.post('/api/v1/jwt/refresh/', {
        refresh_token: refreshToken,
      });

      accessToken = response.data.access_token;

      localStorage.setItem('accessToken', accessToken);

      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

      return response.data;
    } catch (error) {
      console.error('Refresh token error:', error);
      this.logout();
      throw error;
    }
  },

  isAuthenticated() {
    return !!accessToken;
  },

  getApiClient() {
    return apiClient;
  },
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        await auth.refreshToken();
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh token failed, redirect to login
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default auth;