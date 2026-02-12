import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
type DraftId = string | number;

class ApiClient {
  private client: AxiosInstance;
  private inflightGet = new Map<string, Promise<any>>();
  private getCache = new Map<string, { at: number; data: any }>();

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 15000,
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

  async uploadFile(file: File, year: number, caliber: string = 'unit', unitId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('year', year.toString());
    formData.append('caliber', caliber);
    if (unitId) {
      formData.append('unit_id', unitId);
    }

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

  async getDraft(draftId: DraftId) {
    const response = await this.client.get(`/api/drafts/${draftId}`);
    return response.data;
  }

  async listDrafts(params?: { limit?: number; year?: number; unit_id?: string }) {
    const response = await this.client.get('/api/drafts', { params });
    return response.data;
  }

  async updateManualInputs(draftId: DraftId, payload: { inputs: any[]; if_match_updated_at?: string | null }) {
    const response = await this.client.patch(`/api/drafts/${draftId}/manual-inputs`, payload);
    return response.data;
  }

  async getHistoryText(draftId: DraftId, key: string) {
    const response = await this.client.get(`/api/drafts/${draftId}/history-text`, {
      params: { key }
    });
    return response.data;
  }

  async copyPreviousDraft(draftId: DraftId) {
    const response = await this.client.post(`/api/drafts/${draftId}/copy-previous`);
    return response.data;
  }

  async listCopySources(draftId: DraftId) {
    const response = await this.client.get(`/api/drafts/${draftId}/copy-sources`);
    return response.data;
  }

  async copyPreviousDraftFromSource(draftId: DraftId, payload: { source_draft_id?: string; if_match_updated_at?: string | null }) {
    const response = await this.client.post(`/api/drafts/${draftId}/copy-previous`, payload);
    return response.data;
  }

  async getDraftDiffSummary(draftId: DraftId) {
    const cacheKey = `draft:${draftId}:diff-summary`;
    return this.cachedGet(cacheKey, 3000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/diff-summary`);
      return response.data;
    });
  }

  async listBudgetTables(draftId: DraftId) {
    const cacheKey = `draft:${draftId}:budget-tables:index`;
    return this.cachedGet(cacheKey, 5000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/budget-tables`);
      return response.data;
    });
  }

  async getBudgetTable(draftId: DraftId, tableKey: string) {
    const cacheKey = `draft:${draftId}:budget-tables:${tableKey}`;
    return this.cachedGet(cacheKey, 5000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/budget-tables/${tableKey}`);
      return response.data;
    });
  }

  async diagnoseBudgetTables(draftId: DraftId) {
    const cacheKey = `draft:${draftId}:budget-tables:diagnose`;
    return this.cachedGet(cacheKey, 3000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/budget-tables-diagnose`);
      return response.data;
    });
  }

  async getOtherRelatedAuto(draftId: DraftId) {
    const cacheKey = `draft:${draftId}:other-related:auto`;
    return this.cachedGet(cacheKey, 5000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/other-related-auto`);
      return response.data;
    });
  }

  async getDraftReceipt(draftId: DraftId) {
    const response = await this.client.get(`/api/drafts/${draftId}/receipt`);
    return response.data;
  }

  async getLineItems(draftId: DraftId) {
    const cacheKey = `draft:${draftId}:line-items`;
    return this.cachedGet(cacheKey, 3000, async () => {
      const response = await this.client.get(`/api/drafts/${draftId}/line-items`);
      return response.data;
    });
  }

  async updateLineItems(draftId: DraftId, payload: { items: any[]; if_match_updated_at?: string | null }) {
    const response = await this.client.patch(`/api/drafts/${draftId}/line-items`, payload);
    this.invalidateDraftReadCache(draftId);
    return response.data;
  }

  async validateDraft(draftId: DraftId, payload?: { if_match_updated_at?: string | null }) {
    const response = await this.client.post(`/api/drafts/${draftId}/validate`, payload || {});
    return response.data;
  }

  async submitDraft(draftId: DraftId, payload?: { if_match_updated_at?: string | null }) {
    const response = await this.client.post(`/api/drafts/${draftId}/submit`, payload || {});
    return response.data;
  }

  async getIssues(draftId: DraftId, level?: string) {
    const params = level ? { level } : {};
    const response = await this.client.get(`/api/drafts/${draftId}/issues`, { params });
    return response.data;
  }

  async generateReport(draftId: DraftId, payload?: { if_match_updated_at?: string | null }) {
    const response = await this.client.post(`/api/drafts/${draftId}/generate`, payload || {}, {
      // Report generation may take longer than default 15s (Excel fill + PDF conversion).
      timeout: 180000
    });
    return response.data;
  }

  async generateReportPreview(draftId: DraftId, payload?: { if_match_updated_at?: string | null }) {
    const response = await this.client.post(`/api/drafts/${draftId}/preview`, payload || {}, {
      timeout: 180000
    });
    return response.data;
  }

  async createSuggestion(draftId: DraftId, suggestion: any) {
    const response = await this.client.post(`/api/drafts/${draftId}/suggestions`, suggestion);
    return response.data;
  }

  async getDraftSuggestions(draftId: DraftId) {
    const response = await this.client.get(`/api/drafts/${draftId}/suggestions`);
    return response.data;
  }

  async downloadPdf(versionId: number) {
    const response = await this.client.get(`/api/report_versions/${versionId}/download/pdf`, {
      responseType: 'blob',
    });

    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `report_v${versionId}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async downloadExcel(versionId: number) {
    const response = await this.client.get(`/api/report_versions/${versionId}/download/excel`, {
      responseType: 'blob',
    });

    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `report_v${versionId}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async downloadDraftPreviewPdf(draftId: DraftId) {
    const blob = await this.getDraftPreviewPdfBlob(draftId);

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `draft_${draftId}_preview.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async getDraftPreviewPdfBlob(draftId: DraftId): Promise<Blob> {
    const response = await this.client.get(`/api/drafts/${draftId}/preview/pdf`, {
      responseType: 'blob'
    });
    return new Blob([response.data], { type: 'application/pdf' });
  }

  async downloadDraftPreviewExcel(draftId: DraftId) {
    const response = await this.client.get(`/api/drafts/${draftId}/preview/excel`, {
      responseType: 'blob'
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `draft_${draftId}_preview.xls`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async getUnits(params?: { page?: number; pageSize?: number; q?: string; department_id?: string; filter?: string | null; year?: number }) {
    const response = await this.client.get('/api/admin/units', { params });
    return response.data;
  }

  async getDepartments(year?: number) {
    const response = await this.client.get('/api/admin/departments', { params: { year } });
    return response.data;
  }

  async getUnitHistoryYears(unitId: string) {
    const response = await this.client.get(`/api/admin/history/units/${unitId}/years`);
    return response.data;
  }

  async getUnitHistoryByYear(unitId: string, year: number) {
    const response = await this.client.get(`/api/admin/history/units/${unitId}/years/${year}`);
    return response.data;
  }

  private async cachedGet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.getCache.get(key);
    if (cached && now - cached.at < ttlMs) {
      return cached.data as T;
    }

    const inflight = this.inflightGet.get(key);
    if (inflight) {
      return inflight as Promise<T>;
    }

    const request = loader()
      .then((data) => {
        this.getCache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        this.inflightGet.delete(key);
      });

    this.inflightGet.set(key, request);
    return request;
  }

  private invalidateDraftReadCache(draftId: DraftId) {
    const prefix = `draft:${draftId}:`;
    for (const key of Array.from(this.getCache.keys())) {
      if (key.startsWith(prefix)) {
        this.getCache.delete(key);
      }
    }
    for (const key of Array.from(this.inflightGet.keys())) {
      if (key.startsWith(prefix)) {
        this.inflightGet.delete(key);
      }
    }
  }
}

export const apiClient = new ApiClient();
