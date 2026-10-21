import {
  User,
  FamilyMember,
  MedicalReport,
  Doctor,
  NotificationItem,
  FitnessData,
  DietPlan,
  Medication,
  AllergyRecord,
  Vital,
  VitalType,
  HealthAlert,
  AdherenceEntry,
  Reminder,
  CaregiverLink,
  DeviceConnection,
  SafetyCheck,
  SafetyResult,
  PrescriptionAnalysis,
  MonitorOverview,
  DailyBriefing,
  ExerciseRecommendation,
  ToolTraceEntry,
  PendingAction,
  ChatResponse,
  ProviderStatus,
  ComparisonResponse,
  FollowUpTask,
  FollowUpExtraction,
  UpcomingFollowUps,
} from './types';

const TOKEN_KEY = 'healthyfy_jwt_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMessage = 'An unexpected error occurred';
    try {
      const errorData = await response.json();
      errMessage = errorData.error || errMessage;
    } catch {
      errMessage = response.statusText || errMessage;
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    return res;
  },

  async register(data: { name: string; email: string; password: string; phone?: string; city?: string }): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthToken(res.token);
    return res;
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/me');
  },

  async updateProfile(data: { name: string; phone: string; city: string; preferences: { medicationAlarms: boolean; hydrationAlerts: boolean; reportReadyAlerts: boolean; fitnessMilestones: boolean } }): Promise<{ user: User; preferences: typeof data.preferences }> {
    return request<{ user: User; preferences: typeof data.preferences }>('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) });
  },

  // Family Members
  async getFamily(): Promise<FamilyMember[]> {
    return request<FamilyMember[]>('/api/family');
  },

  async createFamilyMember(data: Partial<FamilyMember>): Promise<FamilyMember> {
    return request<FamilyMember>('/api/family', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateFamilyMember(id: string, data: Partial<FamilyMember>): Promise<FamilyMember> {
    return request<FamilyMember>(`/api/family/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteFamilyMember(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/family/${id}`, {
      method: 'DELETE',
    });
  },

  // Medical Reports & Records
  async getRecords(memberId?: string): Promise<MedicalReport[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<MedicalReport[]>(`/api/records${query}`);
  },

  async saveRecord(report: Partial<MedicalReport>): Promise<MedicalReport> {
    return request<MedicalReport>('/api/records', {
      method: 'POST',
      body: JSON.stringify(report),
    });
  },

  async deleteRecord(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/records/${id}`, {
      method: 'DELETE',
    });
  },

  // AI Operations
  async analyzeReport(params: {
    reportType: string;
    reportText?: string;
    imageBase64?: string;
    imageMimeType?: string;
    memberId: string;
  }): Promise<MedicalReport> {
    return request<MedicalReport>('/api/ai/analyze-report', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async chatWithAi(message: string, memberId: string, conversationId?: string): Promise<ChatResponse> {
    return request<ChatResponse>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, memberId, conversationId }),
    });
  },

  async getConversations(): Promise<Array<{ id: string; memberId: string; title: string; messageCount: number; updatedAt: string }>> {
    return request('/api/ai/conversations');
  },

  async getConversation(id: string): Promise<{ id: string; messages: Array<{ role: string; content: string; at: string }> }> {
    return request(`/api/ai/conversations/${id}`);
  },

  async deleteConversation(id: string): Promise<{ success: boolean }> {
    return request(`/api/ai/conversations/${id}`, { method: 'DELETE' });
  },

  async getPendingActions(): Promise<PendingAction[]> {
    return request<PendingAction[]>('/api/agent/pending-actions');
  },

  async getProviderStatus(): Promise<ProviderStatus> {
    return request<ProviderStatus>('/api/ai/provider');
  },
  async approvePendingAction(id: string): Promise<{ success: boolean; result: unknown }> {
    return request(`/api/agent/pending-actions/${id}/approve`, { method: 'POST' });
  },

  async dismissPendingAction(id: string): Promise<{ success: boolean }> {
    return request(`/api/agent/pending-actions/${id}/dismiss`, { method: 'POST' });
  },

  async generateDiet(data: {
    age: number;
    goals: string;
    activityLevel: string;
    dietaryPreference: string;
    allergies: string;
    schedule: string;
    memberId: string;
  }): Promise<DietPlan> {
    return request<DietPlan>('/api/ai/generate-diet', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Doctors
  async getDoctors(params?: { specialty?: string; query?: string; availableToday?: boolean }): Promise<Doctor[]> {
    const q = new URLSearchParams();
    if (params?.specialty) q.append('specialty', params.specialty);
    if (params?.query) q.append('query', params.query);
    if (params?.availableToday) q.append('availableToday', 'true');
    return request<Doctor[]>(`/api/doctors?${q.toString()}`);
  },

  // Fitness
  async getFitness(): Promise<FitnessData> {
    return request<FitnessData>('/api/fitness');
  },

  async toggleFitnessSync(): Promise<{ syncEnabled: boolean; message: string }> {
    return request<{ syncEnabled: boolean; message: string }>('/api/fitness/toggle-sync', {
      method: 'POST',
    });
  },

  // Notifications
  async getNotifications(): Promise<NotificationItem[]> {
    return request<NotificationItem[]>('/api/notifications');
  },

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notifications/${id}/read`, {
      method: 'POST',
    });
  },

  async clearAllNotifications(): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/api/notifications/clear-all', { method: 'POST' });
  },

  async bookAppointment(data: { doctorId: string; date: string; slot: string }) {
    return request<{ id: string; doctorName: string; specialty: string; date: string; slot: string; status: string }>('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
  },

  async getAppointments() {
    return request<Array<{ id: string; doctorName: string; specialty: string; date: string; slot: string; status: string }>>('/api/appointments');
  },

  // ---------------------------------------------------------------
  // Structured medications & adherence
  // ---------------------------------------------------------------
  async getMedications(memberId?: string): Promise<Medication[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<Medication[]>(`/api/medications${query}`);
  },

  async addMedication(data: Partial<Medication>): Promise<{ medication: Medication; safety: SafetyResult }> {
    return request(`/api/medications`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateMedication(id: string, data: Partial<Medication>): Promise<Medication> {
    return request<Medication>(`/api/medications/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async deleteMedication(id: string): Promise<{ success: boolean }> {
    return request(`/api/medications/${id}`, { method: 'DELETE' });
  },

  async getAllergies(memberId?: string): Promise<AllergyRecord[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<AllergyRecord[]>(`/api/allergies${query}`);
  },

  async addAllergy(data: Partial<AllergyRecord>): Promise<AllergyRecord> {
    return request<AllergyRecord>('/api/allergies', { method: 'POST', body: JSON.stringify(data) });
  },

  async deleteAllergy(id: string): Promise<{ success: boolean }> {
    return request(`/api/allergies/${id}`, { method: 'DELETE' });
  },

  async getAdherence(memberId?: string, days = 14): Promise<{
    entries: AdherenceEntry[];
    summary: { total: number; taken: number; skipped: number; late: number; pending: number; adherenceRate: number | null };
  }> {
    const query = new URLSearchParams({ days: String(days) });
    if (memberId) query.append('memberId', memberId);
    return request(`/api/adherence?${query.toString()}`);
  },

  async recordAdherence(data: {
    medicationId: string;
    scheduledAt: string;
    status: 'taken' | 'skipped' | 'late';
    note?: string;
  }): Promise<AdherenceEntry> {
    return request<AdherenceEntry>('/api/adherence', { method: 'POST', body: JSON.stringify(data) });
  },

  // ---------------------------------------------------------------
  // Prescriptions & safety ledger
  // ---------------------------------------------------------------
  async analyzePrescription(data: {
    memberId: string;
    imageBase64?: string;
    imageMimeType?: string;
    prescriptionText?: string;
    commit?: boolean;
  }): Promise<PrescriptionAnalysis> {
    return request<PrescriptionAnalysis>('/api/prescriptions/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getSafetyChecks(memberId?: string): Promise<SafetyCheck[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<SafetyCheck[]>(`/api/safety/checks${query}`);
  },

  async runSafetyCheck(memberId: string, medications: Array<{ name: string; dose?: string }>): Promise<SafetyResult> {
    return request<SafetyResult>('/api/safety/check', {
      method: 'POST',
      body: JSON.stringify({ memberId, medications }),
    });
  },

  // ---------------------------------------------------------------
  // Vitals & monitoring
  // ---------------------------------------------------------------
  async getVitals(params: { memberId?: string; type?: VitalType; hours?: number } = {}): Promise<Vital[]> {
    const query = new URLSearchParams();
    if (params.memberId) query.append('memberId', params.memberId);
    if (params.type) query.append('type', params.type);
    if (params.hours) query.append('hours', String(params.hours));
    return request<Vital[]>(`/api/vitals?${query.toString()}`);
  },

  async recordVital(data: {
    memberId: string;
    type: VitalType;
    value: number;
    secondaryValue?: number;
    unit?: string;
    measuredAt?: string;
    source?: string;
    context?: string;
  }): Promise<{ vital: Vital; alert: HealthAlert | null }> {
    return request('/api/vitals', { method: 'POST', body: JSON.stringify(data) });
  },

  async getMonitorOverview(memberId?: string): Promise<MonitorOverview> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<MonitorOverview>(`/api/monitor/overview${query}`);
  },

  async getAlerts(params: { memberId?: string; status?: string } = {}): Promise<HealthAlert[]> {
    const query = new URLSearchParams();
    if (params.memberId) query.append('memberId', params.memberId);
    if (params.status) query.append('status', params.status);
    return request<HealthAlert[]>(`/api/alerts?${query.toString()}`);
  },

  async acknowledgeAlert(id: string): Promise<HealthAlert> {
    return request<HealthAlert>(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
  },

  async resolveAlert(id: string, note?: string): Promise<HealthAlert> {
    return request<HealthAlert>(`/api/alerts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note }) });
  },

  async reportFall(data: {
    memberId: string;
    location?: { lat: number; lng: number; accuracyM?: number; label?: string };
    sensorTrace?: Record<string, unknown>;
    confidence?: 'high' | 'medium' | 'low';
    source?: string;
  }): Promise<HealthAlert> {
    return request<HealthAlert>('/api/monitor/fall', { method: 'POST', body: JSON.stringify(data) });
  },

  async simulateAlert(data: {
    memberId: string;
    type: string;
    bpm?: number;
    message?: string;
    severity?: 'info' | 'warning' | 'critical';
    location?: { lat: number; lng: number; accuracyM?: number; label?: string };
  }): Promise<HealthAlert | { created: false; message: string }> {
    return request('/api/alerts/simulate', { method: 'POST', body: JSON.stringify(data) });
  },

  // ---------------------------------------------------------------
  // Caregivers, reminders, devices
  // ---------------------------------------------------------------
  async getCaregivers(memberId?: string): Promise<CaregiverLink[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<CaregiverLink[]>(`/api/caregivers${query}`);
  },

  async addCaregiver(data: Partial<CaregiverLink>): Promise<CaregiverLink> {
    return request<CaregiverLink>('/api/caregivers', { method: 'POST', body: JSON.stringify(data) });
  },

  async deleteCaregiver(id: string): Promise<{ success: boolean }> {
    return request(`/api/caregivers/${id}`, { method: 'DELETE' });
  },

  async getReminders(memberId?: string): Promise<Reminder[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<Reminder[]>(`/api/reminders${query}`);
  },

  async addReminder(data: {
    memberId: string;
    type: Reminder['type'];
    title: string;
    message: string;
    times: string[];
  }): Promise<Reminder> {
    return request<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateReminder(id: string, data: Partial<Reminder>): Promise<Reminder> {
    return request<Reminder>(`/api/reminders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async deleteReminder(id: string): Promise<{ success: boolean }> {
    return request(`/api/reminders/${id}`, { method: 'DELETE' });
  },

  async getDevices(memberId?: string): Promise<DeviceConnection[]> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<DeviceConnection[]>(`/api/devices${query}`);
  },

  async addDevice(data: Partial<DeviceConnection>): Promise<DeviceConnection> {
    return request<DeviceConnection>('/api/devices', { method: 'POST', body: JSON.stringify(data) });
  },

  async deleteDevice(id: string): Promise<{ success: boolean }> {
    return request(`/api/devices/${id}`, { method: 'DELETE' });
  },

  async syncDeviceSamples(deviceId: string, samples: Array<{ type: VitalType; value: number; unit?: string; measuredAt?: string }>): Promise<{ accepted: number }> {
    return request('/api/devices/sync', { method: 'POST', body: JSON.stringify({ deviceId, samples }) });
  },

  // ---------------------------------------------------------------
  // Briefing & exercise plan
  // ---------------------------------------------------------------
  async getBriefing(): Promise<DailyBriefing> {
    return request<DailyBriefing>('/api/briefing');
  },

  async getExercisePlan(memberId?: string): Promise<ExerciseRecommendation> {
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
    return request<ExerciseRecommendation>(`/api/exercise-plan${query}`);
  },

  async runScheduler(): Promise<{ dosesOpened: number; promptsSent: number; remindersFired: number; escalations: number; briefingsSent: number }> {
    return request('/api/scheduler/run', { method: 'POST' });
  },

  // ---------------------------------------------------------------
  // Report comparison
  // ---------------------------------------------------------------
  async compareReports(params: { memberId: string; olderId?: string; latestId?: string }): Promise<ComparisonResponse> {
    const query = new URLSearchParams({ memberId: params.memberId });
    if (params.olderId) query.append('olderId', params.olderId);
    if (params.latestId) query.append('latestId', params.latestId);
    return request<ComparisonResponse>(`/api/records/compare?${query.toString()}`);
  },

  // ---------------------------------------------------------------
  // Follow-up tracker
  // ---------------------------------------------------------------
  async getFollowUps(params: { memberId?: string; status?: string } = {}): Promise<FollowUpTask[]> {
    const query = new URLSearchParams();
    if (params.memberId) query.append('memberId', params.memberId);
    if (params.status) query.append('status', params.status);
    return request<FollowUpTask[]>(`/api/follow-up?${query.toString()}`);
  },

  async extractFollowUps(data: {
    memberId: string;
    imageBase64?: string;
    imageMimeType?: string;
    text?: string;
    sourceLabel?: string;
  }): Promise<FollowUpExtraction> {
    return request<FollowUpExtraction>('/api/follow-up/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async saveFollowUps(data: {
    memberId: string;
    items: Array<{
      title: string;
      kind: string;
      detail?: string;
      dueDate?: string;
      dueTime?: string;
      safetyNote?: string;
    }>;
    sourceLabel?: string;
  }): Promise<{ created: FollowUpTask[]; count: number }> {
    return request('/api/follow-up', { method: 'POST', body: JSON.stringify(data) });
  },

  async completeFollowUp(id: string): Promise<FollowUpTask> {
    return request<FollowUpTask>(`/api/follow-up/${id}/complete`, { method: 'POST' });
  },

  async dismissFollowUp(id: string): Promise<FollowUpTask> {
    return request<FollowUpTask>(`/api/follow-up/${id}/dismiss`, { method: 'POST' });
  },

  async remindFollowUp(
    id: string,
    data: { dueDate?: string; dueTime?: string } = {}
  ): Promise<{ task: FollowUpTask; scheduled: boolean; message: string }> {
    return request(`/api/follow-up/${id}/remind`, { method: 'POST', body: JSON.stringify(data) });
  },

  async getUpcomingFollowUps(params: { memberId?: string; days?: number } = {}): Promise<UpcomingFollowUps> {
    const query = new URLSearchParams();
    if (params.memberId) query.append('memberId', params.memberId);
    if (params.days) query.append('days', String(params.days));
    return request<UpcomingFollowUps>(`/api/follow-up/upcoming?${query.toString()}`);
  },
};
