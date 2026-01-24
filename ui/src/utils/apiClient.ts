import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = localStorage.getItem('auth_token');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  async login(username: string, password: string) {
    const response = await this.client.post('/api/auth/login', { email: username, password });
    return response.data;
  }

  async uploadFile(file: File, year: number, caliber: string = 'unit') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('year', year.toString());
    formData.append('caliber', caliber);

    const response = await this.client.post('/api/uploads', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async parseUpload(uploadId: number) {
    const response = await this.client.post(`/api/uploads/${uploadId}/parse`);
    return response.data;
  }

  async getDraft(draftId: number) {
    const response = await this.client.get(`/api/drafts/${draftId}`);
    return response.data;
  }

  async updateManualInputs(draftId: number, inputs: any) {
    const response = await this.client.patch(`/api/drafts/${draftId}/manual-inputs`, inputs);
    return response.data;
  }

  async getLineItems(draftId: number) {
    const response = await this.client.get(`/api/drafts/${draftId}/line-items`);
    return response.data;
  }

  async updateLineItems(draftId: number, items: any[]) {
    const response = await this.client.patch(`/api/drafts/${draftId}/line-items`, { items });
    return response.data;
  }

  async validateDraft(draftId: number) {
    const response = await this.client.post(`/api/drafts/${draftId}/validate`);
    return response.data;
  }

  async getIssues(draftId: number, level?: string) {
    const params = level ? { level } : {};
    const response = await this.client.get(`/api/drafts/${draftId}/issues`, { params });
    return response.data;
  }

  async generateReport(draftId: number) {
    const response = await this.client.post(`/api/drafts/${draftId}/generate`);
    return response.data;
  }

  async createSuggestion(draftId: number, suggestion: any) {
    const response = await this.client.post(`/api/drafts/${draftId}/suggestions`, suggestion);
    return response.data;
  }

  async getDraftSuggestions(draftId: number) {
    const response = await this.client.get(`/api/drafts/${draftId}/suggestions`);
    return response.data;
  }
}

export const apiClient = new ApiClient();
