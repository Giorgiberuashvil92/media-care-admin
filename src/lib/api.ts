// API Service for Medicare Admin Panel
// Use production API by default; override via NEXT_PUBLIC_API_URL if needed
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://mediacare-production.up.railway.app';

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface User {
  id: string;
  role: 'patient' | 'doctor';
  name: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  profileImage?: string;
  isVerified: boolean;
  isActive: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  updatedAt?: string;
  // Doctor specific
  specialization?: string;
  licenseNumber?: string;
  licenseDocument?: string; // File path/URL for medical license (PDF or Image)
  degrees?: string;
  experience?: string;
  consultationFee?: number;
  followUpFee?: number;
  about?: string;
  location?: string;
  rating?: number;
  reviewCount?: number;
  isTopRated?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
    token: string;
    refreshToken: string;
  };
}

export interface Specialization {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  symptoms?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type ShopEntityType = 'laboratory' | 'equipment';

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
  type: ShopEntityType;
  description?: string;
  imageUrl?: string;
  isActive: boolean;
  parentCategory?: string | null;
  order?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  products?: ShopProduct[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  description?: string;
  type: ShopEntityType;
  category?: string | null;
  price?: number;
  currency?: string;
  discountPercent?: number;
  stock?: number;
  unit?: string;
  isActive: boolean;
  isFeatured: boolean;
  imageUrl?: string;
  order?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

class ApiService {
  private baseURL: string;
  private token: string | null = null;
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('accessToken');
    }
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('accessToken', token);
        // Also update cookie
        const isSecure = window.location.protocol === 'https:';
        document.cookie = `accessToken=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax${isSecure ? '; Secure' : ''}`;
      } else {
        localStorage.removeItem('accessToken');
        document.cookie = 'accessToken=; path=/; max-age=0';
      }
    }
  }

  private async refreshToken(): Promise<string | null> {
    // If already refreshing, return the existing promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const refreshToken = typeof window !== 'undefined' 
          ? localStorage.getItem('refreshToken') 
          : null;

        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const response = await fetch(`${this.baseURL}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refreshToken }),
        });

        if (!response.ok) {
          throw new Error('Token refresh failed');
        }

        const data = await response.json();
        
        if (data.success && data.data?.token) {
          this.setToken(data.data.token);
          if (data.data.refreshToken) {
            if (typeof window !== 'undefined') {
              localStorage.setItem('refreshToken', data.data.refreshToken);
            }
          }
          return data.data.token;
        }

        throw new Error('Invalid refresh response');
      } catch (error) {
        // Refresh failed, clear all tokens and redirect to login
        this.setToken(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/auth/sign-in';
        }
        return null;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async makeRequest<T>(
    requestFn: () => Promise<Response>
  ): Promise<T> {
    const response = await requestFn();
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        errorData.message || `HTTP error! status: ${response.status}`;
      
      // If unauthorized (401), try to refresh token and retry
      if (response.status === 401) {
        const newToken = await this.refreshToken();
        
        if (newToken) {
          // Retry the original request with new token
          const retryResponse = await requestFn();
          if (retryResponse.ok) {
            return retryResponse.json();
          }
        }
        
        // If refresh failed or retry failed, redirect to login
        this.setToken(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/auth/sign-in';
        }
      }
      
      throw new Error(errorMessage);
    }
    
    return response.json();
  }

  private async handleResponse<T>(
    response: Response,
    originalRequest?: () => Promise<Response>
  ): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        errorData.message || `HTTP error! status: ${response.status}`;
      
      // If unauthorized (401), try to refresh token
      if (response.status === 401 && originalRequest) {
        const newToken = await this.refreshToken();
        
        if (newToken) {
          // Retry the original request with new token
          const retryResponse = await originalRequest();
          if (retryResponse.ok) {
            return retryResponse.json();
          }
        }
        
        // If refresh failed or retry failed, redirect to login
        this.setToken(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/auth/sign-in';
        }
      } else if (response.status === 401) {
        // No original request to retry, just redirect
        this.setToken(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/auth/sign-in';
        }
      }
      
      throw new Error(errorMessage);
    }
    return response.json();
  }

  // Auth endpoints
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await fetch(`${this.baseURL}/auth/login`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(credentials),
    });

    const data = await this.handleResponse<AuthResponse>(response);
    
    if (data.data.token) {
      this.setToken(data.data.token);
      if (data.data.refreshToken && typeof window !== 'undefined') {
        localStorage.setItem('refreshToken', data.data.refreshToken);
      }
    }

    return data;
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        await fetch(`${this.baseURL}/auth/logout`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ refreshToken }),
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }

    this.setToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }

  // Users endpoints
  async getUsers(params?: {
    page?: number;
    limit?: number;
    role?: 'patient' | 'doctor';
    search?: string;
  }): Promise<ApiResponse<{ users: User[]; pagination: any }>> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.role) queryParams.append('role', params.role);
    if (params?.search) queryParams.append('search', params.search);

    const makeRequest = () => fetch(
      `${this.baseURL}/admin/users?${queryParams.toString()}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
    );

    const response = await makeRequest();

    return this.handleResponse<ApiResponse<{ users: User[]; pagination: any }>>(
      response,
      makeRequest,
    );
  }

  // Doctors endpoints
  async getDoctors(params?: {
    page?: number;
    limit?: number;
    specialization?: string;
    location?: string;
    search?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'all';
  }): Promise<ApiResponse<{ doctors: any[]; pagination: any }>> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.specialization)
      queryParams.append('specialization', params.specialization);
    if (params?.location) queryParams.append('location', params.location);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);

    return this.makeRequest<ApiResponse<{ doctors: any[]; pagination: any }>>(
      () => fetch(
        `${this.baseURL}/doctors?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async getDoctorById(
    id: string,
    includePending: boolean = true,
  ): Promise<ApiResponse<User>> {
    const queryParams = new URLSearchParams();
    if (includePending) {
      queryParams.append('includePending', 'true');
    }

    return this.makeRequest<ApiResponse<User>>(
      () => fetch(
        `${this.baseURL}/doctors/${id}?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async updateDoctor(
    id: string,
    data: Partial<User>,
  ): Promise<ApiResponse<User>> {
    return this.makeRequest<ApiResponse<User>>(
      () => fetch(`${this.baseURL}/doctors/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async uploadLicenseDocument(
    file: File,
  ): Promise<ApiResponse<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>> {
    const formData = new FormData();
    formData.append('file', file);

    return this.makeRequest<
      ApiResponse<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>
    >(
      () => {
        const headers: HeadersInit = {};
        if (this.token) {
          headers['Authorization'] = `Bearer ${this.token}`;
        }
        return fetch(`${this.baseURL}/upload/license`, {
          method: 'POST',
          headers,
          body: formData,
        });
      }
    );
  }

  // Stats endpoint
  async getStats(): Promise<ApiResponse<any>> {
    return this.makeRequest<ApiResponse<any>>(
      () => fetch(`${this.baseURL}/admin/stats`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
    );
  }

  // Specializations endpoints
  async getSpecializations(params?: {
    page?: number;
    limit?: number;
    specialization?: string;
    location?: string;
    search?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'all';
  }): Promise<ApiResponse<{ doctors: any[]; pagination: any }>> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.specialization)
      queryParams.append('specialization', params.specialization);
    if (params?.location) queryParams.append('location', params.location);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);

    return this.makeRequest<ApiResponse<{ doctors: any[]; pagination: any }>>(
      () => fetch(
        `${this.baseURL}/specializations?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async getPublicSpecializations(): Promise<ApiResponse<Specialization[]>> {
    return this.makeRequest<ApiResponse<Specialization[]>>(
      () => fetch(`${this.baseURL}/specializations`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
    );
  }

  async getSpecializationsAdmin(): Promise<ApiResponse<Specialization[]>> {
    return this.makeRequest<ApiResponse<Specialization[]>>(
      () => fetch(`${this.baseURL}/specializations/admin`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
    );
  }

  async createSpecialization(data: {
    name: string;
    description?: string;
    isActive?: boolean;
    symptoms?: string[];
  }): Promise<ApiResponse<Specialization>> {
    return this.makeRequest<ApiResponse<Specialization>>(
      () => fetch(`${this.baseURL}/specializations`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async toggleSpecialization(
    id: string,
    isActive: boolean,
  ): Promise<ApiResponse<Specialization>> {
    return this.makeRequest<ApiResponse<Specialization>>(
      () => fetch(
        `${this.baseURL}/specializations/${id}/toggle?isActive=${isActive}`,
        {
          method: 'PATCH',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async updateSpecialization(
    id: string,
    data: { name?: string; description?: string; isActive?: boolean; symptoms?: string[] },
  ): Promise<ApiResponse<Specialization>> {
    return this.makeRequest<ApiResponse<Specialization>>(
      () => fetch(`${this.baseURL}/specializations/${id}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async deleteSpecialization(id: string): Promise<ApiResponse<null>> {
    return this.makeRequest<ApiResponse<null>>(
      () => fetch(`${this.baseURL}/specializations/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      })
    );
  }

  // Medicine shop endpoints
  async getShopCategories(params?: {
    type?: ShopEntityType;
    search?: string;
    isActive?: boolean;
    parentCategory?: string;
    includeProducts?: boolean;
  }): Promise<ApiResponse<ShopCategory[]>> {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.search) queryParams.append('search', params.search);
    if (typeof params?.isActive === 'boolean')
      queryParams.append('isActive', String(params.isActive));
    if (params?.parentCategory) queryParams.append('parentCategory', params.parentCategory);
    if (params?.includeProducts)
      queryParams.append('includeProducts', String(params.includeProducts));

    return this.makeRequest<ApiResponse<ShopCategory[]>>(
      () => fetch(
        `${this.baseURL}/shop/categories?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async createShopCategory(
    data: Pick<ShopCategory, 'name' | 'type'> &
      Partial<
        Pick<
          ShopCategory,
          | 'description'
          | 'imageUrl'
          | 'isActive'
          | 'order'
          | 'parentCategory'
          | 'metadata'
        >
      >,
  ): Promise<ApiResponse<ShopCategory>> {
    return this.makeRequest<ApiResponse<ShopCategory>>(
      () => fetch(`${this.baseURL}/admin/shop/categories`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async updateShopCategory(
    id: string,
    data: Partial<ShopCategory>,
  ): Promise<ApiResponse<ShopCategory>> {
    return this.makeRequest<ApiResponse<ShopCategory>>(
      () => fetch(
        `${this.baseURL}/admin/shop/categories/${id}`,
        {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify(data),
        },
      )
    );
  }

  async deleteShopCategory(id: string): Promise<ApiResponse<{ message: string }>> {
    return this.makeRequest<ApiResponse<{ message: string }>>(
      () => fetch(
        `${this.baseURL}/admin/shop/categories/${id}`,
        {
          method: 'DELETE',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async getShopProducts(params?: {
    type?: ShopEntityType;
    category?: string;
    search?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<
    ApiResponse<{
      items: ShopProduct[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>
  > {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.category) queryParams.append('category', params.category);
    if (params?.search) queryParams.append('search', params.search);
    if (typeof params?.isActive === 'boolean')
      queryParams.append('isActive', String(params.isActive));
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    return this.makeRequest<
      ApiResponse<{
        items: ShopProduct[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>
    >(
      () => fetch(
        `${this.baseURL}/shop/products?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )
    );
  }

  async createShopProduct(
    data: Pick<ShopProduct, 'name' | 'type'> &
      Partial<
        Pick<
          ShopProduct,
          | 'description'
          | 'price'
          | 'currency'
          | 'discountPercent'
          | 'stock'
          | 'unit'
          | 'category'
          | 'isActive'
          | 'isFeatured'
          | 'imageUrl'
          | 'order'
          | 'metadata'
        >
      >,
  ): Promise<ApiResponse<ShopProduct>> {
    return this.makeRequest<ApiResponse<ShopProduct>>(
      () => fetch(`${this.baseURL}/admin/shop/products`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async updateShopProduct(
    id: string,
    data: Partial<ShopProduct>,
  ): Promise<ApiResponse<ShopProduct>> {
    return this.makeRequest<ApiResponse<ShopProduct>>(
      () => fetch(`${this.baseURL}/admin/shop/products/${id}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      })
    );
  }

  async deleteShopProduct(id: string): Promise<ApiResponse<{ message: string }>> {
    return this.makeRequest<ApiResponse<{ message: string }>>(
      () => fetch(`${this.baseURL}/admin/shop/products/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      })
    );
  }

  // Create super admin (public endpoint for initial setup)
  async createSuperAdmin(): Promise<ApiResponse<{ email: string; password: string; note?: string }>> {
    const response = await fetch(`${this.baseURL}/admin/create-superadmin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return this.handleResponse<ApiResponse<{ email: string; password: string; note?: string }>>(response);
  }

  // Admin Appointments Management
  async getAdminAppointments(params: {
    page?: number;
    limit?: number;
    status?: string;
    paymentStatus?: string;
    search?: string;
  }): Promise<ApiResponse<{
    appointments: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>> {
    const queryParams = new URLSearchParams();
    
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.status && params.status !== 'all') queryParams.append('status', params.status);
    if (params.paymentStatus && params.paymentStatus !== 'all') queryParams.append('paymentStatus', params.paymentStatus);
    if (params.search) queryParams.append('search', params.search);

    return this.makeRequest<ApiResponse<{
      appointments: any[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>>(
      () => fetch(`${this.baseURL}/admin/appointments?${queryParams.toString()}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
    );
  }

  async updateAppointmentStatus(appointmentId: string, status: string): Promise<ApiResponse<any>> {
    return this.makeRequest<ApiResponse<any>>(
      () => fetch(`${this.baseURL}/admin/appointments/${appointmentId}/status`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({ status }),
      })
    );
  }

  async updateDoctorApproval(
    doctorId: string, 
    approvalStatus: 'pending' | 'approved' | 'rejected', 
    isActive?: boolean
  ): Promise<ApiResponse<any>> {
    return this.makeRequest<ApiResponse<any>>(
      () => fetch(`${this.baseURL}/admin/doctors/${doctorId}/approval`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({ approvalStatus, isActive }),
      })
    );
  }

  // Generic API call
  async apiCall<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<ApiResponse<T>>(
      () => fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      })
    );
  }
}

export const apiService = new ApiService();

