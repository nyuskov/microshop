// src/services/api.ts
import { useAuthStore } from "../stores/auth";
import type { Group } from "../types";

const BACKEND_HOST = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_PREFIX = "/api/v1";

const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const authStore = useAuthStore();
  const token = authStore.accessToken;

  if (!token) {
    throw new Error("Access token is missing");
  }

  const url = `${BACKEND_HOST}${API_PREFIX}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

export const groupApi = {
  fetchGroups: (): Promise<Group[]> => apiCall("/groups/"),
  fetchGroupById: (id: number): Promise<Group> => apiCall(`/groups/${id}`),
  // Здесь можно добавить createGroup, updateGroup, deleteGroup позже
};